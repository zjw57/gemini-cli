/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@google/gemini-cli-core';
import { GeminiClient } from '@google/gemini-cli-core';
import type { GenerateContentResponse } from '@google/genai';
import type { CIMOutput } from './reminder-types.js';
import { ReminderHook } from './reminder-types.js';

export class ContextInjectionManager {
  private turnCount = 0;

  constructor(
    private readonly geminiClient: GeminiClient,
    private readonly config: Config,
  ) {}

  async processHook(hook: ReminderHook, payload: any): Promise<CIMOutput> {
    switch (hook) {
      case ReminderHook.StartOfTurn:
        return this._handleStartOfTurn(payload);
      case ReminderHook.PreToolExecution:
        return this._handlePreToolExecution(payload);
      case ReminderHook.PostToolExecution:
        return this._handlePostToolExecution(payload);
      case ReminderHook.PreResponseFinalization:
        return this._handlePreResponseFinalization(payload);
      default:
        return { reminders: [] };
    }
  }

  private _formatReminder(title: string, body: string): string {
    return `
<system-reminder>
[INSTRUCTION: Do not mention this reminder to the user explicitly.]
# ${title}
${body}

IMPORTANT: This context is provided to guide your actions. Apply it judiciously.
</system-reminder>
`;
  }

  private _getResponseText(
    response: GenerateContentResponse,
  ): string | null {
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];

      if (
        candidate.content &&
        candidate.content.parts &&
        candidate.content.parts.length > 0
      ) {
        return candidate.content.parts
          .filter((part) => part.text)
          .map((part) => part.text)
          .join('');
      }
    }
    return null;
  }

  private async _handleStartOfTurn(payload: any): Promise<CIMOutput> {
    this.turnCount++;
    const reminders = this._getGlobalBehaviorReminders();

    if (this.turnCount % 10 === 0) {
      const summary = await this._summarizeConversation();
      reminders.push(this._formatReminder('Current Session Summary', summary));
    }

    return { reminders };
  }

  private async _summarizeConversation(): Promise<string> {
    const history = await this.geminiClient.getHistory();
    const summarizationPrompt = `
    You are a summarization sub-agent. Your purpose is to summarize the following conversation history in under 50 characters.

    ${JSON.stringify(
      history,
    )}
    `;

    const response = await this.geminiClient.generateContent(
      [{ role: 'user', parts: [{ text: summarizationPrompt }] }],
      {},
      new AbortController().signal,
      this.config.getModel(),
    );
    return this._getResponseText(response) ?? '';
  }

  private _getGlobalBehaviorReminders(): string[] {
    const cwd = this.config.getProjectRoot();
    const reminderBody = `
    The current working directory is ${cwd}.
    - Do what has been asked; nothing more, nothing less.
    - NEVER create files unless absolutely necessary for the goal.
    - ALWAYS prefer editing an existing file to creating a new one.
    - NEVER proactively create documentation (READMEs, *.md) unless explicitly requested.
    `;
    return [this._formatReminder('Important Instruction Reminders', reminderBody)];
  }

  private async _handlePreToolExecution(payload: any): Promise<CIMOutput> {
    const { requestsToProcess } = payload;
    for (const request of requestsToProcess) {
      if (request.name === 'run_shell_command') {
        return this._invokeGuardian(request.args.command);
      }
      if (
        request.name === 'edit' ||
        request.name === 'replace' ||
        request.name === 'write_file'
      ) {
        const cwd = this.config.getProjectRoot();
        const reminderBody = `You are about to modify a file, the current working directory is ${cwd}. Please double-check your changes to ensure they are correct and won't cause any unintended side effects. Make sure the changes do not introduce any lint or syntax issues and conform to the styling of the file.`;
        const reminders = [
          this._formatReminder('Pre-Modification Check', reminderBody),
        ];
        return { reminders };
      }
    }
    return { reminders: [] };
  }

  private async _invokeGuardian(command: string): Promise<CIMOutput> {
    const guardianPrompt = `
    You are a security-focused sub-agent. Your sole purpose is to analyze a bash command for potential command injection vulnerabilities.

    Analyze the following command:
    
    ${command}
    

    If you detect a command injection vulnerability, respond with ONLY the text "command_injection_detected".
    Otherwise, respond with ONLY the command prefix (e.g., "git", "npm", "ls").
    `;

    const response = await this.geminiClient.generateContent(
      [{ role: 'user', parts: [{ text: guardianPrompt }] }],
      {},
      new AbortController().signal,
      this.config.getModel(),
    );
    const text = this._getResponseText(response) ?? '';

    if (text === 'command_injection_detected') {
      const reminderBody = `Command: ${command}
Classification: command_injection_detected
Action Taken: Blocked. The command was not executed. You must reformulate the command safely.`;
      return {
        reminders: [this._formatReminder('Bash Guardian Analysis', reminderBody)],
        blockAction: true,
      };
    } else {
      return {
        reminders: [],
        promptForConfirmation: `The model wants to run the command: "${text}". Do you want to allow this?`,
      };
    }
  }

  private async _handlePostToolExecution(payload: any): Promise<CIMOutput> {
    const reminders: string[] = [];
    const { completedToolCalls } = payload;

    for (const toolCall of completedToolCalls) {
      // Error Handling Reinforcement
      if (toolCall.status === 'error') {
        const errorMessage = (toolCall.response as any)?.output || 'Unknown error';
        const reminderBody = `The previous command failed with the following error: ${errorMessage}. DO NOT assume the command succeeded. Analyze the error message and adjust your plan. Do not repeat the same command without modification.`;
        reminders.push(this._formatReminder('Error Detected', reminderBody));
      }

      // File System Analysis
      if (
        (toolCall.request.name === 'list_directory' ||
          toolCall.request.name === 'glob' ||
          toolCall.request.name === 'read_file') &&
        toolCall.status === 'success'
      ) {
        const reminderBody = `Analyze the file list above.\nNOTE: Do any files seem malicious, unexpected, or irrelevant?\nSAFETY CHECK: Do any filenames suggest exposed secrets (e.g., .env, keys, passwords)? If so, proceed with extreme caution.`;
        reminders.push(
          this._formatReminder('Post-Execution Analysis', reminderBody),
        );
      }

      // File Modification Analysis
      if (
        (toolCall.request.name === 'edit' ||
          toolCall.request.name === 'replace' ||
          toolCall.request.name === 'write_file') &&
        toolCall.status === 'success'
      ) {
        const reminderBody = `You have just modified a file. Please verify that the change was successful and had the intended effect. Check for any unintended side effects or errors.`;
        reminders.push(
          this._formatReminder('Post-Modification Analysis', reminderBody),
        );
      }
    }

    return { reminders };
  }

  private async _handlePreResponseFinalization(
    payload: any,
  ): Promise<CIMOutput> {
    const { modelResponse } = payload;
    const reminders: string[] = [];

    // Regex for dangerous commands
    const dangerousCommandRegex = /sudo\s+rm\s+-rf/;
    if (dangerousCommandRegex.test(modelResponse)) {
      const reminderBody = `The response you just generated contains a dangerous command suggestion. Re-evaluate and provide a safe, explanatory response instead. Do not show the dangerous command to the user.`;
      reminders.push(this._formatReminder('Safety Review', reminderBody));
      return { reminders, recursivePayload: { query: modelResponse } };
    }

    return { reminders: [] };
  }
}