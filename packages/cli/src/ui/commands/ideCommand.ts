/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'url';
import { Config, ideIntegrationManager } from '@google/gemini-cli-core';
import {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import * as child_process from 'child_process';
import * as process from 'process';
import { glob } from 'glob';
import * as path from 'path';

const VSCODE_COMMAND = process.platform === 'win32' ? 'code.cmd' : 'code';
const VSCODE_COMPANION_EXTENSION_FOLDER = 'vscode-ide-companion';

function isVSCodeInstalled(): boolean {
  try {
    child_process.execSync(
      process.platform === 'win32'
        ? `where.exe ${VSCODE_COMMAND}`
        : `command -v ${VSCODE_COMMAND}`,
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

export const ideCommand = (config: Config | null): SlashCommand | null => {
  if (!config?.getIdeMode()) {
    return null;
  }

  return {
    name: 'ide',
    description: 'manage IDE integration',
    subCommands: [
      {
        name: 'status',
        description: 'check status of IDE integration',
        action: async (
          _context: CommandContext,
        ): Promise<SlashCommandActionReturn> => {
          // Initialize IDE integration manager if not already done
          await ideIntegrationManager.initialize({
            environment: process.env,
            timeout: 5000,
            debug: config?.getDebugMode() || false,
          });

          const managerStatus = await ideIntegrationManager.getStatus();

          let statusMessage = '';

          if (managerStatus.active && managerStatus.integration) {
            const { integration } = managerStatus;
            const statusIcon = integration.available ? '🟢' : '🔴';
            const statusText = integration.available
              ? 'Connected'
              : 'Disconnected';
            statusMessage = `${statusIcon} MCP Integration - ${statusText}`;
            statusMessage += `\n   Protocol-first IDE integration via MCP`;
          } else {
            statusMessage = `🔴 No IDE integration active`;
            statusMessage += `\n\n💡 MCP Integration: Automatically detects any MCP-compatible IDE`;
            statusMessage += `\n   Currently supported: VS Code (with companion extension)`;
            statusMessage += `\n   Run '/ide install' to install companion extensions`;
          }

          return {
            type: 'message',
            messageType:
              managerStatus.active && managerStatus.integration?.available
                ? 'info'
                : 'error',
            content: statusMessage,
          };
        },
      },
      {
        name: 'install',
        description: 'install companion extensions for supported IDEs',
        action: async (context) => {
          // Check which IDEs are available on the system
          const availableIDEs: Array<{
            id: string;
            name: string;
            installer: () => Promise<void>;
          }> = [];

          // Check for VS Code
          if (isVSCodeInstalled()) {
            availableIDEs.push({
              id: 'vscode',
              name: 'Visual Studio Code',
              installer: async () => {
                const bundleDir = path.dirname(fileURLToPath(import.meta.url));
                let vsixFiles = glob.sync(path.join(bundleDir, '*.vsix'));
                if (vsixFiles.length === 0) {
                  const devPath = path.join(
                    bundleDir,
                    '..',
                    '..',
                    '..',
                    '..',
                    '..',
                    VSCODE_COMPANION_EXTENSION_FOLDER,
                    '*.vsix',
                  );
                  vsixFiles = glob.sync(devPath);
                }

                if (vsixFiles.length === 0) {
                  throw new Error(
                    'Could not find the required VS Code companion extension. Please file a bug via /bug.',
                  );
                }

                const vsixPath = vsixFiles[0];
                const command = `${VSCODE_COMMAND} --install-extension ${vsixPath} --force`;
                child_process.execSync(command, { stdio: 'pipe' });
              },
            });
          }

          // Future: Add checks for other IDEs here
          // if (isIntelliJInstalled()) { ... }
          // if (isVimInstalled()) { ... }

          if (availableIDEs.length === 0) {
            context.ui.addItem(
              {
                type: 'error',
                text: 'No supported IDEs found on your system. Currently supported: VS Code',
              },
              Date.now(),
            );
            return;
          }

          // If only one IDE is available, install directly
          if (availableIDEs.length === 1) {
            const ide = availableIDEs[0];
            context.ui.addItem(
              {
                type: 'info',
                text: `Found ${ide.name}. Installing companion extension...`,
              },
              Date.now(),
            );

            try {
              await ide.installer();
              context.ui.addItem(
                {
                  type: 'info',
                  text: `${ide.name} companion extension installed successfully. Restart gemini-cli in a fresh terminal window.`,
                },
                Date.now(),
              );
            } catch (error) {
              context.ui.addItem(
                {
                  type: 'error',
                  text: `Failed to install ${ide.name} companion extension: ${error instanceof Error ? error.message : String(error)}`,
                },
                Date.now(),
              );
            }
          } else {
            // Multiple IDEs available - show options (for future enhancement)
            context.ui.addItem(
              {
                type: 'info',
                text: `Multiple IDEs detected: ${availableIDEs.map((ide) => ide.name).join(', ')}. Currently installing for all supported IDEs...`,
              },
              Date.now(),
            );

            for (const ide of availableIDEs) {
              try {
                context.ui.addItem(
                  {
                    type: 'info',
                    text: `Installing companion extension for ${ide.name}...`,
                  },
                  Date.now(),
                );

                await ide.installer();

                context.ui.addItem(
                  {
                    type: 'info',
                    text: `✅ ${ide.name} companion extension installed successfully.`,
                  },
                  Date.now(),
                );
              } catch (error) {
                context.ui.addItem(
                  {
                    type: 'error',
                    text: `❌ Failed to install ${ide.name} companion extension: ${error instanceof Error ? error.message : String(error)}`,
                  },
                  Date.now(),
                );
              }
            }

            context.ui.addItem(
              {
                type: 'info',
                text: 'Installation complete. Restart gemini-cli in a fresh terminal window.',
              },
              Date.now(),
            );
          }
        },
      },
    ],
  };
};
