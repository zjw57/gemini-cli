/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import open from 'open';
import process from 'node:process';
import stripAnsi from 'strip-ansi';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';

const BOX_WIDTH = 120;

function drawBox(content: string): string {
  const lines = content.split('\n');
  const top = '╭' + '─'.repeat(BOX_WIDTH - 2) + '╮';
  const bottom = '╰' + '─'.repeat(BOX_WIDTH - 2) + '╯';

  const middle = lines
    .map((line) => {
      // Truncate long lines
      const truncatedLine =
        line.length > BOX_WIDTH - 4
          ? line.slice(0, BOX_WIDTH - 7) + '...'
          : line;
      return '│ ' + truncatedLine.padEnd(BOX_WIDTH - 4, ' ') + ' │';
    })
    .join('\n');

  return [top, middle, bottom].join('\n');
}

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

    const cliResponses = subsequentItems
      .reduce((acc, item) => {
        let responseText = '';
        switch (item.type) {
          case 'gemini':
          case 'gemini_content':
            responseText = `✦ ${stripAnsi(item.text)}`;
            break;
          case 'tool_group':
            responseText = item.tools
              .map((tool) => {
                let output = `Tool Call: ${tool.name}, Status: ${
                  tool.status
                }\nDescription: ${tool.description || 'N/A'}`;
                if (tool.resultDisplay) {
                  if (
                    typeof tool.resultDisplay === 'object' &&
                    'fileDiff' in tool.resultDisplay
                  ) {
                    output += `\nOutput:\n${tool.resultDisplay.fileDiff}`;
                  } else if (typeof tool.resultDisplay === 'string') {
                    output += `\nOutput:\n${tool.resultDisplay}`;
                  }
                }
                return drawBox(output);
              })
              .join('\n');
            break;
          case 'error':
            responseText = `✕ ${stripAnsi(item.text)}`;
            break;
          case 'info':
            if (item.text.startsWith('To submit your bug report')) {
              return acc;
            }
            responseText = `ℹ ${stripAnsi(item.text)}`;
            break;
          default:
            return acc;
        }
        acc.push(responseText);
        return acc;
      }, [] as string[])
      .join('\n\n---\n\n');

    const lastCliResponse = cliResponses.length ? cliResponses : 'N/A';

    const problem = [
      '**Last User Prompt**',
      '```',
      lastUserPrompt?.text || 'N/A',
      '```',
      '',
      '**Last Gemini CLI Response**',
      '```',
      lastCliResponse,
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
