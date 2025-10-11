/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDevelopment } from '../utils/installationInfo.js';
import type { ICommandLoader } from './types.js';
import type { SlashCommand } from '../ui/commands/types.js';
import type { Config } from '@google/gemini-cli-core';

/**
 * Loads the core, hard-coded slash commands that are an integral part
 * of the Gemini CLI application.
 */
export class BuiltinCommandLoader implements ICommandLoader {
  constructor(private config: Config | null) {}

  /**
   * Gathers all raw built-in command definitions, injects dependencies where
   * needed (e.g., config) and filters out any that are not available.
   *
   * @param _signal An AbortSignal (unused for this synchronous loader).
   * @returns A promise that resolves to an array of `SlashCommand` objects.
   */
  async loadCommands(_signal: AbortSignal): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];
    const commandTimes: Record<string, number> = {};

    const load = async (name: string, importFn: () => Promise<any>) => {
      const start = performance.now();
      try {
        const module = await importFn();

        // 1. Try named export matching the command name
        let rawCmd = module[name];

        // 2. Try default export
        if (!rawCmd) {
          rawCmd = module.default;
        }

        if (!rawCmd) {
          console.error(`No command found in module for ${name}`);
          return;
        }

        const cmd = rawCmd as
          | SlashCommand
          | ((config: Config | null) => SlashCommand)
          | (() => Promise<SlashCommand>);

        if (typeof cmd === 'function') {
          // Handle command factories (restoreCommand) and async factories (ideCommand)
          const result = await cmd(this.config);
          if (result && result.name) commands.push(result);
        } else if (cmd && cmd.name) {
          commands.push(cmd);
        } else {
          console.error(`Invalid command object for ${name}:`, cmd);
        }
      } catch (e) {
        console.error(`Failed to load command ${name}:`, e);
      } finally {
        commandTimes[name] = performance.now() - start;
      }
    };

    console.log('--- Starting Builtin Command Import Profiling ---');

    await load('aboutCommand', () =>
      import('../ui/commands/aboutCommand.js'),
    );
    await load('authCommand', () => import('../ui/commands/authCommand.js'));
    await load('bugCommand', () => import('../ui/commands/bugCommand.js'));
    await load('chatCommand', () => import('../ui/commands/chatCommand.js'));
    await load('clearCommand', () => import('../ui/commands/clearCommand.js'));
    await load('compressCommand', () =>
      import('../ui/commands/compressCommand.js'),
    );
    await load('copyCommand', () => import('../ui/commands/copyCommand.js'));
    await load('corgiCommand', () => import('../ui/commands/corgiCommand.js'));
    await load('docsCommand', () => import('../ui/commands/docsCommand.js'));
    await load('directoryCommand', () =>
      import('../ui/commands/directoryCommand.js'),
    );
    await load('editorCommand', () =>
      import('../ui/commands/editorCommand.js'),
    );
    await load('extensionsCommand', () =>
      import('../ui/commands/extensionsCommand.js'),
    );
    await load('helpCommand', () => import('../ui/commands/helpCommand.js'));
    await load('ideCommand', () => import('../ui/commands/ideCommand.js'));
    await load('initCommand', () => import('../ui/commands/initCommand.js'));
    await load('mcpCommand', () => import('../ui/commands/mcpCommand.js'));
    await load('memoryCommand', () =>
      import('../ui/commands/memoryCommand.js'),
    );

    if (this.config?.getUseModelRouter()) {
      await load('modelCommand', () =>
        import('../ui/commands/modelCommand.js'),
      );
    }
    if (this.config?.getFolderTrust()) {
      await load('permissionsCommand', () =>
        import('../ui/commands/permissionsCommand.js'),
      );
    }

    await load('privacyCommand', () =>
      import('../ui/commands/privacyCommand.js'),
    );

    if (isDevelopment) {
      await load('profileCommand', () =>
        import('../ui/commands/profileCommand.js'),
      );
    }

    await load('quitCommand', () => import('../ui/commands/quitCommand.js'));
    await load('restoreCommand', () =>
      import('../ui/commands/restoreCommand.js'),
    );
    await load('statsCommand', () => import('../ui/commands/statsCommand.js'));
    await load('themeCommand', () => import('../ui/commands/themeCommand.js'));
    await load('toolsCommand', () => import('../ui/commands/toolsCommand.js'));
    await load('settingsCommand', () =>
      import('../ui/commands/settingsCommand.js'),
    );
    await load('vimCommand', () => import('../ui/commands/vimCommand.js'));
    await load('setupGithubCommand', () =>
      import('../ui/commands/setupGithubCommand.js'),
    );
    await load('terminalSetupCommand', () =>
      import('../ui/commands/terminalSetupCommand.js'),
    );

    console.log('Builtin Command Import Times:');
    const sortedTimes = Object.entries(commandTimes).sort(
      ([, a], [, b]) => b - a,
    );
    for (const [name, time] of sortedTimes) {
      console.log(`- ${name}: ${time.toFixed(2)}ms`);
    }
    console.log('--- End Profiling ---');

    return commands;
  }
}