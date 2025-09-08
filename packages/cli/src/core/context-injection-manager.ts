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

// Define a timeout for sub-agent calls (e.g., Guardian, Summarizer)
const SUB_AGENT_TIMEOUT_MS = 8000;

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

  /**
   * Helper to safely inject a reminder into the tool call response output.
   * This ensures compliance with the Gemini API constraint that tool response turns
   * must not contain separate text parts.
   */
  private _injectReminderIntoToolOutput(toolCall: any, reminder: string): void {
    if (!toolCall || !toolCall.response) {
        return;
    }

    // 1. Inject into display output strings if they exist (for UI consistency)
    if (typeof toolCall.response.output === 'string') {
        toolCall.response.output += `\n${reminder}`;
    }
    if (typeof toolCall.response.resultDisplay === 'string') {
        toolCall.response.resultDisplay += `\n${reminder}`;
    }

    // 2. CRITICAL: Inject into the responseParts which are sent to the API.
    if (Array.isArray(toolCall.response.responseParts)) {
        toolCall.response.responseParts.forEach((part: any) => {
            // Handle potential naming variations (functionResponse vs toolResponse) used in the core library
            const responseWrapper = part.functionResponse || part.toolResponse;

            // Ensure we are modifying the correct response for this specific tool call
            // Note: In parallel tool calls, multiple parts might exist, we modify the one matching the name.
            if (responseWrapper && responseWrapper.name === toolCall.request.name) {
                // The actual response content is often nested within a 'response' object inside the wrapper.
                const actualResponse = responseWrapper.response || responseWrapper;

                if (actualResponse && typeof actualResponse.output === 'string') {
                    actualResponse.output += `\n${reminder}`;
                }
            }
        });
    }
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
          .join('')
          .trim(); // Ensure clean output
      }
    }
    return null;
  }

  // --- HOOK A: Start of Turn (Front-loading Context) ---

  private async _handleStartOfTurn(payload: any): Promise<CIMOutput> {
    this.turnCount++;
    const reminders = this._getGlobalBehaviorReminders();

    // Summarize periodically (e.g., every 8 turns) to maintain context without excessive latency.
    if (this.turnCount > 1 && this.turnCount % 8 === 0) {
      // Pass history if available in the payload, otherwise fetch it.
      const history = payload.history ?? (await this.geminiClient.getHistory());
      const summary = await this._summarizeConversation(history);
      if (summary) {
        reminders.push(this._formatReminder('Current Session Status', summary));
      }
    }

    return { reminders };
  }

  private async _summarizeConversation(history: any): Promise<string | null> {

    // Use a dedicated AbortController with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUB_AGENT_TIMEOUT_MS);

    // Structured prompt focusing on actionable context
    const summarizationPrompt = `
    You are a task summarization sub-agent. Analyze the conversation history and provide a concise summary (max 150 words) of the current task and status.

    Use this structure:
    GOAL: [The main objective]
    STATUS: [Current progress and immediate obstacles]
    NEXT STEP: [The immediate next action required]

    History:
    ${JSON.stringify(history)}
    `;

    try {
      const response = await this.geminiClient.generateContent(
        [{ role: 'user', parts: [{ text: summarizationPrompt }] }],
        { temperature: 0.2 }, // Factual and deterministic summarization
        controller.signal,
        this.config.getModel(),
      );
      return this._getResponseText(response) ?? 'Summary unavailable.';
    } catch (error) {
      // Handle potential errors (e.g., timeout) gracefully
      console.warn('CIM: Failed to summarize conversation:', error);
      return null; // Do not inject failure text if summarization fails
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private _getGlobalBehaviorReminders(): string[] {
    const cwd = this.config.getProjectRoot();
    // Enhanced reminders with clear strategic directives
    const reminderBody = `
    The current working directory (CWD) is: ${cwd}
    All relative paths MUST be relative to this CWD.

    CORE DIRECTIVES:
    1. **Analyze & Plan:** Before acting, analyze the request and the current state (file system, previous outputs).
    2. **Proactive Exploration:** Use 'list_directory' (ls -F) or 'glob' extensively to understand the file structure. Do not guess file paths.
    3. **Informed Modification:** Use 'read_file' to understand file contents BEFORE attempting 'edit' or 'replace'.
    4. **Minimalism & Precision:** Do exactly what was asked; nothing more, nothing less.
        - NEVER create files unless strictly necessary.
        - ALWAYS prefer 'edit' or 'replace' over 'write_file' for existing files.
        - Ensure modifications are precise, syntactically correct, and adhere to the existing style.
        - NEVER proactively create documentation (READMEs, *.md).
    5. **Verification:** After executing a command, verify its success or analyze its failure. Do not assume success.
    6. **Strict Protocol Adherence:** CRITICAL API RULE: NEVER combine text explanations with tool calls (functionCall) in the same response. A response must contain ONLY text OR ONLY tool calls.
    `;
    return [this._formatReminder('Important Instruction Reminders', reminderBody)];
  }

  // --- HOOK B: Pre-Tool Execution (Validation and Gating) ---

  private async _handlePreToolExecution(payload: any): Promise<CIMOutput> {
    const { requestsToProcess } = payload;
    const reminders: string[] = [];
    let promptForConfirmation: string | undefined = undefined;

    if (!requestsToProcess) return { reminders: [] };

    // Iterate through all requests to handle parallel tool calls and perform necessary checks.
    for (const request of requestsToProcess) {
      // Priority 1: Guardian Check for shell commands
      if (request.name === 'run_shell_command' || request.name === 'bash') {
        const command = request.args.command || request.args.script;
        if (!command) continue;

        const guardianResult = await this._invokeGuardian(command);

        // If Guardian blocks, we stop immediately and return the block result.
        if (guardianResult.blockAction) {
          return guardianResult;
        }

        // Aggregate confirmations. Use the most detailed prompt found.
        if (guardianResult.promptForConfirmation) {
          promptForConfirmation = guardianResult.promptForConfirmation;
        }
        reminders.push(...guardianResult.reminders);
      }

      // Note: Pre-modification checks are handled in Hook D (PreResponseFinalization)
      // to enable mandatory self-correction before the tool call is finalized.
    }

    return { reminders, promptForConfirmation };
  }

  private async _invokeGuardian(command: string): Promise<CIMOutput> {
    // Use a dedicated AbortController with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUB_AGENT_TIMEOUT_MS);

    // Few-shot prompting for robust classification
    const guardianPrompt = `
    You are a security-focused sub-agent (The Guardian). Your sole purpose is to analyze a bash command for potential command injection vulnerabilities or highly destructive behavior.

    RULES:
    1. Analyze the command provided.
    2. If the command contains command injection (e.g., subshells \`$()\`, backticks \` \`, semicolons \`;\` used dangerously) OR if it is highly destructive (e.g., 'rm -rf /', 'mkfs'), respond with ONLY the text "DANGER_DETECTED".
    3. Otherwise, extract the primary command prefix (the first word) and respond with ONLY that prefix (e.g., "git", "npm", "ls").

    EXAMPLES:
    Command: ls -la
    Response: ls

    Command: git commit -m "update"
    Response: git

    Command: cat file.txt | grep "secret"
    Response: cat

    Command: ls; rm -rf /
    Response: DANGER_DETECTED

    Command: echo \`cat /etc/passwd\`
    Response: DANGER_DETECTED

    Analyze the following command:
    
    ${command}
    `;

    try {
      const response = await this.geminiClient.generateContent(
        [{ role: 'user', parts: [{ text: guardianPrompt }] }],
        { temperature: 0.0, topK: 1 }, // Deterministic classification
        controller.signal,
        this.config.getModel(),
      );
      const text = this._getResponseText(response) ?? '';

      if (text === 'DANGER_DETECTED') {
        const reminderBody = `Command: ${command}
Classification: DANGER_DETECTED (Potential command injection or destructive behavior)
Action Taken: Blocked. The command was not executed.
Instruction: You must reformulate the command safely or use alternative tools (like file system tools) if possible.`;
        return {
          reminders: [this._formatReminder('Bash Guardian: Action Blocked', reminderBody)],
          blockAction: true,
        };
      } else if (text) {
        // If safe, prompt the user with clear context.
        return {
          reminders: [],
          promptForConfirmation: `The model is requesting to run a command starting with: "${text}".\n\nFull command:\n\`\`\`bash\n${command}\n\`\`\`\n\nDo you want to allow this?`,
        };
      } else {
         // Handle unexpected empty response from Guardian (Fail Closed)
         const reminderBody = `Guardian sub-agent failed to analyze the command. Action blocked for safety. Please review your strategy.`;
         return {
          reminders: [this._formatReminder('Bash Guardian: Analysis Failure', reminderBody)],
          blockAction: true,
        };
      }
    } catch (error) {
      // Handle timeout/error (Fail Closed)
      console.warn('CIM: Guardian invocation failed or timed out:', error);
      const reminderBody = `Guardian sub-agent timed out or failed. Action blocked for safety. Please review your strategy.`;
       return {
        reminders: [this._formatReminder('Bash Guardian: Timeout/Error', reminderBody)],
        blockAction: true,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // --- HOOK C: Post-Tool Execution (Analysis and Feedback) ---

  /**
   * Handles PostToolExecution by injecting reminders directly into the tool output payload.
   * This avoids the API error caused by adding separate text parts to a tool response turn.
   */
  private async _handlePostToolExecution(payload: any): Promise<CIMOutput> {
    const { completedToolCalls } = payload;

    // Handle cases where the input might be malformed if the framework isn't robust.
    if (!completedToolCalls || completedToolCalls.length === 0) {
        return { reminders: [] };
    }

    for (const toolCall of completedToolCalls) {
      // C.1. Error Handling Reinforcement
      if (toolCall.status === 'error') {
        const errorMessage = (toolCall.response as any)?.output || 'Unknown error';
        const commandName = toolCall.request.name;
        // Significantly stronger error reminder.
        const reminderBody = `The tool '${commandName}' FAILED.
Error details: ${errorMessage}

CRITICAL: DO NOT assume the command succeeded. DO NOT ignore this error.

ACTION REQUIRED:
1. Analyze the error message carefully. Why did it fail?
2. DO NOT repeat the exact same command.
3. Adjust your plan. Common fixes include checking file paths, permissions, command syntax, or dependencies.
`;
        const reminder = this._formatReminder('Tool Execution Failure Detected', reminderBody);
        this._injectReminderIntoToolOutput(toolCall, reminder);
        
        // If an error occurred, focus the agent solely on the error.
        break;
      }

      // C.2. File System Analysis (ls, glob)
      if (
        (toolCall.request.name === 'list_directory' ||
          toolCall.request.name === 'glob') &&
        toolCall.status === 'success'
      ) {
        const reminderBody = `Analyze the file list generated by the previous command.

TASK FOCUS: Which files are relevant to the current objective? Identify the specific files you need to read or modify next.
SAFETY CHECK: Do any filenames suggest exposed secrets (e.g., .env, keys)? If so, avoid reading them unless absolutely necessary.
`;
        const reminder = this._formatReminder('File System Analysis', reminderBody);
        this._injectReminderIntoToolOutput(toolCall, reminder);
      }

      // C.3. File Content Analysis (read_file)
      if (toolCall.request.name === 'read_file' && toolCall.status === 'success') {
        const reminderBody = `Analyze the file content generated by the previous command.

COMPREHENSION CHECK: Understand the code structure, dependencies, and logic.
STRATEGY CHECK: Plan your edits carefully based on this content. Ensure you preserve the existing structure and style when using 'edit' or 'replace'.
`;
        const reminder = this._formatReminder('File Content Analysis', reminderBody);
        this._injectReminderIntoToolOutput(toolCall, reminder);
      }

      // C.4. File Modification Analysis
      if (
        (toolCall.request.name === 'edit' ||
          toolCall.request.name === 'replace' ||
          toolCall.request.name === 'write_file') &&
        toolCall.status === 'success'
      ) {
        const reminderBody = `You have successfully modified a file.

VERIFICATION REQUIRED:
Do not assume the change works as intended. You must now verify the outcome.
Suggested actions:
1. Run relevant tests or build commands if applicable to the project.
2. If tests are unavailable, re-read the file ('read_file') to confirm the content is exactly correct.
`;
        const reminder = this._formatReminder('Post-Modification Verification Nudge', reminderBody);
        this._injectReminderIntoToolOutput(toolCall, reminder);
      }
    }

    // We return an empty reminders array because we injected them directly into the payload.
    return { reminders: [] };
  }

  // --- HOOK D: Pre-Response-Finalization (Self-Correction and Refinement) ---

  private async _handlePreResponseFinalization(
    payload: any,
  ): Promise<CIMOutput> {
    // This hook receives the proposed response (text or tool calls) before finalization.
    // We assume the payload contains 'modelResponse' (string, for text) and/or 'requestsToProcess' (array, for tools).
    const { modelResponse, requestsToProcess } = payload;
    const reminders: string[] = [];

    // --- D.0. Enforce Turn Separation (Text OR Tools) ---
    // CRITICAL: Check if both text and tool calls are present in the proposed response.
    // This prevents the API protocol violation error seen in the logs.
    if (
        modelResponse && typeof modelResponse === 'string' && modelResponse.trim().length > 0 &&
        requestsToProcess && requestsToProcess.length > 0
    ) {
        const reminderBody = `PROTOCOL VIOLATION: You MUST NOT combine text responses (explanations, greetings) and tool calls in the same turn. This violates the API protocol and destabilizes the agent.

INSTRUCTION: Choose ONE action for this turn:
1. If the tool calls are the next necessary step, reissue ONLY the tool calls immediately, without any accompanying text.
2. If the text response is critical (e.g., asking the user a clarifying question or finalizing the task), issue ONLY the text response.

Decide and reissue your response now.
`;
        reminders.push(this._formatReminder('Protocol Violation: Do Not Mix Text and Tools', reminderBody));

        // Trigger recursion. We rely on the injected reminder and the conversation history to guide the correction.
        return {
            reminders,
            recursivePayload: {
                // We use a generic instruction as the query. The history context will handle the rest.
                query: `[Self-Correction Required: Review Protocol Violation reminder and reissue response.]`,
                // Optionally include these if the core loop can utilize them during recursion
                // proposed_text: modelResponse,
                // proposed_tools: requestsToProcess
            }
        };
    }


    // --- D.1. Text Response Analysis ---
    if (modelResponse && typeof modelResponse === 'string') {
        // Check 1: Safety Review (Dangerous suggestions in text)
        // Expanded patterns for catastrophic commands.
        const dangerousPatterns = [
            /(sudo\s+)?rm\s+-(r|f|rf)\s+\//, // rm -rf /
            /mkfs\./,
            /:(){ :|:& };:/, // Fork bomb
            />\s*\/dev\/sda/
        ];
        
        for (const pattern of dangerousPatterns) {
            if (pattern.test(modelResponse)) {
                const reminderBody = `SAFETY VIOLATION: The response you just generated contains a potentially catastrophic command suggestion. This is strictly forbidden. Re-evaluate immediately and provide a safe response. Do not show the dangerous command to the user.`;
                reminders.push(this._formatReminder('Catastrophic Command Detected', reminderBody));
                // Trigger recursion for self-correction.
                return { reminders, recursivePayload: { query: modelResponse } };
            }
        }

        // Check 2: Anti-Stalling and Persona Adherence
        const stallingPhrases = [
            "I'm sorry, but I cannot",
            "As an AI assistant",
            "I don't have the capability to",
            "I apologize",
        ];
        if (stallingPhrases.some(phrase => modelResponse.toLowerCase().includes(phrase.toLowerCase()))) {
            const reminderBody = `Your previous response included apologies, disclaimers, or indicated you are stuck. Maintain your persona as an efficient CLI assistant. You DO have the necessary tools. Review the available tools and history. Try a different strategy or explore the environment more thoroughly. Do not give up.`;
            reminders.push(this._formatReminder('Strategy Review - Do Not Stall', reminderBody));
            return { reminders, recursivePayload: { query: modelResponse } };
        }

        // Check 3: Use Tools, Do Not Explain
        // If the model responded with text AND did not call any tools (assuming requestsToProcess is empty or null).
        if (!requestsToProcess || requestsToProcess.length === 0) {
            const actionDescriptionPatterns = [
                /I will now (edit|create|modify|run|execute)/i,
                /First, I need to (read|check|list)/i,
                /The next step is to/i,
                /^Okay, here is the plan:/i
            ];

            for (const pattern of actionDescriptionPatterns) {
                if (pattern.test(modelResponse)) {
                    const reminderBody = `You are describing actions or plans in plain text. Stop explaining and start executing. You MUST use the provided tools (e.g., 'ls', 'read_file', 'edit') to interact with the environment. Issue the appropriate tool call immediately in a dedicated turn.`;
                    reminders.push(this._formatReminder('Strategy Nudge: Use Tools, Do Not Explain', reminderBody));
                    return { reminders, recursivePayload: { query: modelResponse } };
                }
            }
        }

        // Check 4: Hallucinated Success Claim
        const successKeywords = ["task completed", "task is done", "finished the task", "successfully implemented", "all done"];
        const isSuccessMessage = successKeywords.some(keyword => modelResponse.toLowerCase().includes(keyword));

        if (isSuccessMessage) {
            const reminderBody = `You are claiming the task is complete. Have you thoroughly verified the results? Did you run tests? Did you ensure all requirements from the original prompt were met? Double-check your work. If you haven't verified, outline the steps you will take to verify now.`;
            reminders.push(this._formatReminder('Verification Required: Success Claim', reminderBody));
            return { reminders, recursivePayload: { query: modelResponse } };
        }
    }

    // --- D.2. Tool Call Analysis (Self-Correction) ---
    if (requestsToProcess && requestsToProcess.length > 0) {
        for (const request of requestsToProcess) {
            // Check 5: Pre-Modification Self-Review (Mandatory)
            // This forces the model to review its own generated code before execution.
            if (
                request.name === 'edit' ||
                request.name === 'replace' ||
                request.name === 'write_file'
            ) {
                // Handle variations in argument naming (e.g., path vs file_path)
                const filePath = request.args.path || request.args.file_path || 'Unknown Path';

                // Force a self-correction loop before the action is executed.
                const reminderBody = `You are attempting to modify a file: ${filePath}.

CRITICAL SELF-REVIEW CHECKLIST:
1. Have you read the latest version of this file?
2. Are the changes (diff/content) precise, complete, and syntactically correct?
3. Do they conform to the existing file's style and formatting?
4. Will these changes introduce bugs or unintended side effects?

INSTRUCTION: Review your proposed tool call against this checklist.
If you are 100% confident, repeat the exact same tool call now.
If you have any doubt, revise your plan (e.g., read the file first, adjust the arguments).
`;
                reminders.push(this._formatReminder('Pre-Modification Self-Review (Mandatory)', reminderBody));

                // Trigger recursion. The model must reconsider the response with the new reminder injected.
                // The payload structure depends on how the core loop handles recursion for tool calls.
                return { reminders, recursivePayload: { previous_requests: requestsToProcess } };
            }

            // Check 6: Large File Write Warning
            if (request.name === 'write_file') {
                const content = request.args.content || '';
                // Threshold for "large" files where 'edit' is usually preferred.
                if (content.length > 5000 || content.split('\n').length > 150) {
                    const reminderBody = `You are attempting to write a very large amount of content (${content.length} chars) using 'write_file'.

WARNING: This is often inefficient and error-prone if the file already exists. Strongly consider using 'edit' or 'replace' instead.

INSTRUCTION: If you are sure 'write_file' is necessary (e.g., creating a new large file), repeat the command. Otherwise, change your strategy to use 'edit'/'replace'.
`;
                    reminders.push(this._formatReminder('Strategy Nudge: Large File Write', reminderBody));
                    return { reminders, recursivePayload: { previous_requests: requestsToProcess } };
                }
            }
        }
    }

    return { reminders: [] };
  }
}