/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import open from 'open';
import process from 'node:process';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';

export const bugCommand: SlashCommand = {
  name: 'bug',
  description: 'submit a bug report',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args?: string): Promise<void> => {
    const bugDescription = (args || '').trim();
    const { config } = context.services;

    const osVersion = `${process.platform} ${process.version}`;
    let sandboxEnv = 'no sandbox';
    if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
      sandboxEnv = process.env.SANDBOX.replace(/^gemini-(?:code-)?/, '');
    } else if (process.env.SANDBOX === 'sandbox-exec') {
      sandboxEnv = `sandbox-exec (${
        process.env.SEATBELT_PROFILE || 'unknown'
      })`;
    }
    const modelVersion = config?.getModel() || 'Unknown';
    const cliVersion = await getCliVersion();
    const memoryUsage = formatMemoryUsage(process.memoryUsage().rss);

    const userPrompts = context.ui.history.filter(
      (item) => item.type === 'user' && !item.text.startsWith('/bug'),
    );
    const lastUserPrompt = userPrompts.pop();

    const lastUserPromptIndex = lastUserPrompt
      ? context.ui.history.lastIndexOf(lastUserPrompt)
      : -1;

    const subsequentItems =
      lastUserPromptIndex === -1
        ? context.ui.history
        : context.ui.history.slice(lastUserPromptIndex + 1);

    const geminiResponses = subsequentItems
      .filter(
        (item) =>
          item.type === 'gemini' ||
          item.type === 'gemini_content' ||
          item.type === 'tool_group' ||
          item.type === 'error' ||
          item.type === 'info',
      )
      .map((item) => {
        switch (item.type) {
          case 'gemini':
          case 'gemini_content':
            return item.text;
          case 'tool_group':
            return item.tools
              .map((tool) => `Tool Call: ${tool.name}, Status: ${tool.status}`)
              .join('\n');
          case 'error':
            return `Error: ${item.text}`;
          case 'info':
            return `Info: ${item.text}`;
          default:
            return '';
        }
      })
      .join('\n\n---\n\n');

    const lastGeminiResponse = geminiResponses.length ? geminiResponses : 'N/A';

    const problem = [
      '**Last User Prompt**',
      '```',
      lastUserPrompt?.text || 'N/A',
      '```',
      '',
      '**Last Gemini CLI Response**',
      '```',
      lastGeminiResponse,
      '```',
    ].join('\n');

    const info = `
* **CLI Version:** ${cliVersion}
* **Git Commit:** ${GIT_COMMIT_INFO}
* **Operating System:** ${osVersion}
* **Sandbox Environment:** ${sandboxEnv}
* **Model Version:** ${modelVersion}
* **Memory Usage:** ${memoryUsage}
`;

    let bugReportUrl =
      'https://github.com/google-gemini/gemini-cli/issues/new?template=bug_report.yml&title={title}&info={info}&problem={problem}';

    const bugCommandSettings = config?.getBugCommand();
    if (bugCommandSettings?.urlTemplate) {
      bugReportUrl = bugCommandSettings.urlTemplate;
    }

    bugReportUrl = bugReportUrl
      .replace('{title}', encodeURIComponent(bugDescription))
      .replace('{info}', encodeURIComponent(info))
      .replace('{problem}', encodeURIComponent(problem));

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `To submit your bug report, please open the following URL in your browser:\n${bugReportUrl}`,
      },
      Date.now(),
    );

    try {
      await open(bugReportUrl);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Could not open URL in browser: ${errorMessage}`,
        },
        Date.now(),
      );
    }
  },
};
