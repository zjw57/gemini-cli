/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandModule } from 'yargs';
import { handleInstall } from './extensions/install.js';
import { SettingScope } from '../config/settings.js';

const installCommand: CommandModule = {
  command: 'install [source]',
  describe: 'Installs an extension from a git repository or a local path.',
  builder: (yargs) =>
    yargs
      .positional('source', {
        describe: 'The git URL of the extension to install.',
        type: 'string',
      })
      .option('path', {
        describe: 'Path to a local extension directory.',
        type: 'string',
      })
      .option('scope', {
        describe: 'The scope to enable the extension in.',
        type: 'string',
        choices: [SettingScope.User, SettingScope.Workspace],
        default: SettingScope.User,
      })
      .conflicts('source', 'path')
      .check((argv) => {
        if (!argv.source && !argv.path) {
          throw new Error('Either a git URL or a --path must be provided.');
        }
        return true;
      }),
  handler: async (argv) => {
    await handleInstall({
      source: argv['source'] as string | undefined,
      path: argv['path'] as string | undefined,
      scope: argv['scope'] as SettingScope | undefined,
    });
  },
};

export const extensionsCommand: CommandModule = {
  command: 'extensions <command>',
  describe: 'Manage Gemini CLI extensions.',
  builder: (yargs) =>
    yargs
      .command(installCommand)
      .demandCommand(1, 'You need at least one command before continuing.')
      .version(false),
  handler: () => {
    // This handler is not called when a subcommand is provided.
    // Yargs will show the help menu.
  },
};
