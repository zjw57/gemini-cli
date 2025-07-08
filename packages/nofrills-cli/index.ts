#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall as originalExecuteToolCall,
  ToolRegistry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  AuthType,
  sessionId,
  FileDiscoveryService,
  ConfigParameters,
  DEFAULT_GEMINI_FLASH_MODEL,
  GeminiChat,
  getMCPServerStatus,
  MCPServerStatus,
  MCPDiscoveryState,
  getMCPDiscoveryState,
  Logger,
  ToolConfirmationOutcome,
  ToolCallResponseInfo,
  getCoreSystemPrompt,
} from '@google/gemini-cli-core';
import {
  Content,
  Part,
  FunctionCall,
  GenerateContentResponse,
} from '@google/genai';
import * as readline from 'readline';
import open from 'open';
import { getCliVersion } from './src/version.js';
import { promises as fs } from 'fs';
import path from 'path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const sessionStartTime = new Date();

async function executeToolCall(
  config: Config,
  requestInfo: ToolCallRequestInfo,
  toolRegistry: ToolRegistry,
  abortSignal: AbortSignal,
): Promise<ToolCallResponseInfo> {
  let confirmation = ToolConfirmationOutcome.Cancel; // Default to cancel

  while (true) {
    const answer = await new Promise<string>((resolve) => {
      // Ensure the question is on a new line.
      process.stdout.write('\n');
      const question = `Allow execution of tool "${requestInfo.name}"? (y/n/d/always) `;
      rl.question(question, resolve);
    });

    const normalizedAnswer = answer.toLowerCase().trim();

    if (normalizedAnswer === 'y' || normalizedAnswer === 'yes') {
      confirmation = ToolConfirmationOutcome.ProceedOnce;
      break;
    } else if (normalizedAnswer === 'always') {
      confirmation = ToolConfirmationOutcome.ProceedAlways;
      break;
    } else if (normalizedAnswer === 'd' || normalizedAnswer === 'details') {
      console.log('Tool call details:');
      console.log(`  Name: ${requestInfo.name}`);
      console.log(`  Arguments: ${JSON.stringify(requestInfo.args, null, 2)}`);
      // Loop again to ask for confirmation
    } else {
      // 'n', 'no', or anything else
      confirmation = ToolConfirmationOutcome.Cancel;
      break;
    }
  }

  if (confirmation === ToolConfirmationOutcome.Cancel) {
    const errorMessage = 'Tool call cancelled by user.';
    return {
      callId: requestInfo.callId,
      responseParts: [],
      error: new Error(errorMessage),
      resultDisplay: errorMessage,
    };
  }

  // TODO: Handle "always"
  return originalExecuteToolCall(
    config,
    requestInfo,
    toolRegistry,
    abortSignal,
  );
}

export const formatDuration = (milliseconds: number): string => {
  if (milliseconds <= 0) {
    return '0s';
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  const totalSeconds = milliseconds / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${seconds}s`);
  }

  if (parts.length === 0) {
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  return parts.join(' ');
};

interface SlashCommand {
  name: string;
  description: string;
  action: (
    chat: GeminiChat,
    config: Config,
    subCommand?: string,
    args?: string,
  ) => void | Promise<void>;
}

const slashCommands: SlashCommand[] = [
  {
    name: '/help',
    description: 'Shows a list of available commands.',
    action: () => {
      console.log('Available commands:');
      slashCommands.forEach((cmd) => {
        console.log(`${cmd.name}: ${cmd.description}`);
      });
    },
  },
  {
    name: '/exit',
    description: 'Exits the application.',
    action: async () => {
      if (isTelemetrySdkInitialized()) {
        await shutdownTelemetry();
      }
      rl.close();
    },
  },
  {
    name: '/clear',
    description: 'Clears the chat history.',
    action: (chat: GeminiChat) => {
      chat.clearHistory();
      console.clear();
    },
  },
  {
    name: '/docs',
    description: 'open full Gemini CLI documentation in your browser',
    action: async () => {
      const docsUrl = 'https://goo.gle/gemini-cli-docs';
      console.log(`Opening documentation in your browser: ${docsUrl}`);
      await open(docsUrl);
    },
  },
  {
    name: '/stats',
    description: 'check session stats. Usage: /stats [model|tools]',
    action: (chat: GeminiChat, config: Config, subCommand?: string) => {
      if (subCommand === 'model') {
        console.log('Model stats are not available in this CLI.');
        return;
      } else if (subCommand === 'tools') {
        console.log('Tool stats are not available in this CLI.');
        return;
      }

      const now = new Date();
      const wallDuration = now.getTime() - sessionStartTime.getTime();

      console.log(`Session duration: ${formatDuration(wallDuration)}`);
    },
  },
  {
    name: '/mcp',
    description: 'list configured MCP servers and tools',
    action: async (chat: GeminiChat, config: Config) => {
      const toolRegistry = await config.getToolRegistry();
      if (!toolRegistry) {
        console.log('Could not retrieve tool registry.');
        return;
      }

      const mcpServers = config.getMcpServers() || {};
      const serverNames = Object.keys(mcpServers);

      if (serverNames.length === 0) {
        const docsUrl = 'https://goo.gle/gemini-cli-docs-mcp';
        console.log(
          `No MCP servers configured. Please see ${docsUrl} for more information.`,
        );
        return;
      }

      const connectingServers = serverNames.filter(
        (name) => getMCPServerStatus(name) === MCPServerStatus.CONNECTING,
      );
      const discoveryState = getMCPDiscoveryState();

      let message = '';

      if (
        discoveryState === MCPDiscoveryState.IN_PROGRESS ||
        connectingServers.length > 0
      ) {
        message += `⏳ MCP servers are starting up (${connectingServers.length} initializing).` + '\n';
        message += `Note: First startup may take longer. Tool availability will update automatically.` + '\n\n';
      }

      message += 'Configured MCP servers:' + '\n\n';

      for (const serverName of serverNames) {
        const serverTools = toolRegistry.getToolsByServer(serverName);
        const status = getMCPServerStatus(serverName);

        let statusIndicator = '';
        let statusText = '';
        switch (status) {
          case MCPServerStatus.CONNECTED:
            statusIndicator = '🟢';
            statusText = 'Ready';
            break;
          case MCPServerStatus.CONNECTING:
            statusIndicator = '🔄';
            statusText = 'Starting... (first startup may take longer)';
            break;
          case MCPServerStatus.DISCONNECTED:
          default:
            statusIndicator = '🔴';
            statusText = 'Disconnected';
            break;
        }

        const server = mcpServers[serverName];

        message += `${statusIndicator} ${serverName} - ${statusText}`;

        if (status === MCPServerStatus.CONNECTED) {
          message += ` (${serverTools.length} tools)`;
        } else if (status === MCPServerStatus.CONNECTING) {
          message += ` (tools will appear when ready)`;
        } else {
          message += ` (${serverTools.length} tools cached)`;
        }

        if (server?.description) {
          const descLines = server.description.trim().split('\n');
          if (descLines) {
            message += ':' + '\n';
            for (const descLine of descLines) {
              message += `    ${descLine}` + '\n';
            }
          } else {
            message += '\n';
          }
        } else {
          message += '\n';
        }

        if (serverTools.length > 0) {
          serverTools.forEach((tool) => {
            if (tool.description) {
              message += `  - ${tool.name}:` + '\n';
              const descLines = tool.description.trim().split('\n');
              if (descLines) {
                for (const descLine of descLines) {
                  message += `      ${descLine}` + '\n';
                }
              }
            } else {
              message += `  - ${tool.name}` + '\n';
            }
          });
        } else {
          message += '  No tools available' + '\n';
        }
        message += '\n';
      }
      console.log(message);
    },
  },
  {
    name: '/memory',
    description:
      'manage memory. Usage: /memory <show|refresh|add> [text for add]',
    action: (
      chat: GeminiChat,
      config: Config,
      subCommand?: string,
      args?: string,
    ) => {
      switch (subCommand) {
        case 'show':
          console.log('Memory show is not available in this CLI.');
          return;
        case 'refresh':
          console.log('Memory refresh is not available in this CLI.');
          return;
        case 'add':
          if (!args || args.trim() === '') {
            console.log('Usage: /memory add <text to remember>');
            return;
          }
          console.log(`Attempting to save to memory: "${args.trim()}"`);
          // This is where the tool call would be scheduled.
          // In this CLI, we'll just log it.
          console.log(
            'Tool call scheduling is not implemented in this CLI.',
          );
          return;
        case undefined:
          console.log(
            'Missing command\nUsage: /memory <show|refresh|add> [text for add]',
          );
          return;
        default:
          console.log(
            `Unknown /memory command: ${subCommand}. Available: show, refresh, add`,
          );
          return;
      }
    },
  },
  {
    name: '/tools',
    description: 'list available Gemini CLI tools',
    action: async (chat: GeminiChat, config: Config) => {
      const toolRegistry = await config.getToolRegistry();
      const tools = toolRegistry.getAllTools();
      if (!tools) {
        console.log('Could not retrieve tools.');
        return;
      }
      const geminiTools = tools.filter((tool) => !('serverName' in tool));
      let message = 'Available Gemini CLI tools:\n\n';
      if (geminiTools.length > 0) {
        geminiTools.forEach((tool) => {
          message += `  - ${tool.displayName} (${tool.name})\n`;
        });
      } else {
        message += '  No tools available\n';
      }
      console.log(message);
    },
  },
  {
    name: '/about',
    description: 'show version info',
    action: async (chat: GeminiChat, config: Config) => {
      const osVersion = process.platform;
      const modelVersion = config.getModel() || 'Unknown';
      const cliVersion = await getCliVersion();
      console.log(`\n*   **CLI Version:** ${cliVersion}\n*   **Operating System:** ${osVersion}\n*   **Model Version:** ${modelVersion}\n`);
    },
  },
  {
    name: '/bug',
    description: 'submit a bug report',
    action: async () => {
      console.log(
        'Please submit bug reports to: https://github.com/google-gemini/gemini-cli/issues',
      );
    },
  },
  {
    name: '/chat',
    description:
      'Manage conversation history. Usage: /chat <list|save|resume> [tag]',
    action: async (
      chat: GeminiChat,
      config: Config,
      subCommand?: string,
      args?: string,
    ) => {
      const tag = (args || '').trim();
      const logger = new Logger(config.getSessionId() || '');
      await logger.initialize();

      if (!subCommand) {
        console.log(
          'Missing command\nUsage: /chat <list|save|resume> [tag]',
        );
        return;
      }
      switch (subCommand) {
        case 'save': {
          const history = chat.getHistory();
          if (history.length > 0) {
            await logger.saveCheckpoint(chat.getHistory() || [], tag);
            console.log(
              `Conversation checkpoint saved${tag ? ' with tag: ' + tag : ''}.`,
            );
          } else {
            console.log('No conversation found to save.');
          }
          return;
        }
        case 'resume':
        case 'restore':
        case 'load': {
          const conversation = await logger.loadCheckpoint(tag);
          if (conversation.length === 0) {
            console.log(
              `No saved checkpoint found${tag ? ' with tag: ' + tag : ''}.`,
            );
            return;
          }

          chat.clearHistory();
          for (const item of conversation) {
            chat.addHistory(item);
          }
          console.clear();
          console.log('Conversation restored.');
          return;
        }
        case 'list':
          const geminiDir = config.getProjectTempDir();
          if (!geminiDir) {
            console.log('Could not determine .gemini directory.');
            return;
          }
          try {
            const files = await fs.readdir(geminiDir);
            const tags = files
              .filter(
                (file) =>
                  file.startsWith('checkpoint-') && file.endsWith('.json'),
              )
              .map((file) =>
                file.replace('checkpoint-', '').replace('.json', ''),
              );
            console.log('list of saved conversations: ' + tags.join(', '));
          } catch (_err) {
            console.log('No saved conversations found.');
          }
          return;
        default:
          console.log(
            `Unknown /chat command: ${subCommand}. Available: list, save, resume`,
          );
          return;
      }
    },
  },
];

async function run(config: Config): Promise<void> {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      process.exit(0);
    }
  });

  const geminiClient = config.getGeminiClient();
  const toolRegistry: ToolRegistry = await config.getToolRegistry();
  

    const systemPromptText = getCoreSystemPrompt();

  console.log('system-prompt', systemPromptText);
  const chat = await geminiClient.getChat();

  // Add the system prompt as the first message.
  chat.addHistory({
    role: 'user',
    parts: [{ text: systemPromptText }],
  });
  chat.addHistory({
    role: 'model',
    parts: [{ text: 'OK.' }],
  });


  while (true) {
    const input = await new Promise<string>((resolve) => {
      rl.question('input: ', resolve);
    });

    const parts = input.trim().split(/\s+/);
    const commandName = parts[0];
    const subCommand = parts[1];
    const args = parts.slice(2).join(' ');

    const command = slashCommands.find((cmd) => cmd.name === commandName);
    if (command) {
      await command.action(chat, config, subCommand, args);
      if (commandName === '/exit') {
        break;
      }
    } else {
      try {
        const abortController = new AbortController();

        // First turn: send user prompt
        const responseStream = await chat.sendMessageStream({
          message: [{ text: input }],
          config: {
            abortSignal: abortController.signal,
            tools: [
              {
                functionDeclarations: toolRegistry.getFunctionDeclarations(),
              },
            ],
          },
        });

        const functionCalls: FunctionCall[] = [];
        let modelResponseText = '';

        for await (const resp of responseStream) {
          if (abortController.signal.aborted) {
            console.error('Operation cancelled.');
            return;
          }
          const textPart =
            resp.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
          if (textPart) {
            modelResponseText += textPart;
          }
          if (resp.functionCalls) {
            functionCalls.push(...resp.functionCalls);
          }
        }

        // Print any text response from the first turn.
        if (modelResponseText) {
          process.stdout.write(modelResponseText);
        }

        // Second turn: if there are tool calls, execute them and respond.
        if (functionCalls.length > 0) {
          const toolResponseParts: (string | Part)[] = [];
          for (const fc of functionCalls) {
            const callId = fc.id ?? `${fc.name}-${Date.now()}`;
            const requestInfo: ToolCallRequestInfo = {
              callId,
              name: fc.name as string,
              args: (fc.args ?? {}) as Record<string, unknown>,
              isClientInitiated: false,
            };

            const toolResponse = await executeToolCall(
              config,
              requestInfo,
              toolRegistry,
              abortController.signal,
            );

            if (toolResponse.error) {
              console.error(
                `Error executing tool ${fc.name}: ${
                  toolResponse.resultDisplay || toolResponse.error.message
                }`,
              );
              // If the tool call was cancelled, we should stop processing.
              if (
                toolResponse.error.message.includes(
                  'Tool call cancelled by user',
                )
              ) {
                break;
              }
            }

            if (toolResponse.responseParts) {
              if (Array.isArray(toolResponse.responseParts)) {
                toolResponseParts.push(...toolResponse.responseParts);
              } else {
                toolResponseParts.push(toolResponse.responseParts);
              }
            }
          }

          if (toolResponseParts.length > 0) {
            const secondResponseStream = await chat.sendMessageStream({
              message: toolResponseParts,
            });

            for await (const resp of secondResponseStream) {
              const textPart =
                resp.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
              if (textPart) {
                process.stdout.write(textPart);
              }
            }
          }
        }
      } catch (error) {
        console.error(error);
      }
      process.stdout.write('\n');
    }
  }
}

async function main() {
  const cwd = process.cwd();
  const configParams: ConfigParameters = {
    sessionId: sessionId,
    targetDir: cwd,
    debugMode: false,
    model: DEFAULT_GEMINI_FLASH_MODEL,
    cwd: cwd,
    fileDiscoveryService: new FileDiscoveryService(cwd),
  };

  const config = new Config(configParams);

  if (!process.env.GEMINI_API_KEY) {
    console.error('Please set the GEMINI_API_KEY environment variable.');
    process.exit(1);
  }

  await config.refreshAuth(AuthType.USE_GEMINI);

  await run(config);
}

main().catch((error) => {
  console.error('An unexpected critical error occurred:');
  if (error instanceof Error) {
    console.error(error.stack);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});