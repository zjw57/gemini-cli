/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandModule } from 'yargs';
import { handleInstall, Scope } from './extensions/install.js';

const installCommand: CommandModule = {
  command: 'install',
  describe: 'Installs an extension from a git repository or a local path.',
  builder: (yargs) =>
    yargs
      .option('source', {
        describe: 'The git URL of the extension to install.',
        type: 'string',
        conflicts: 'path',
      })
      .option('path', {
        describe: 'Path to a local extension directory.',
        type: 'string',
        conflicts: 'source',
      })
      .option('scope', {
        describe: 'The scope to install the extension to.',
        type: 'string',
        choices: [Scope.USER, Scope.PROJECT],
        default: Scope.USER,
      })
      .check((argv) => {
        if (!argv.source && !argv.path) {
          throw new Error(
            'Either a --source git URL or a --path must be provided.',
          );
        }
        return true;
      }),
  handler: async (argv) => {
    await handleInstall({
      source: argv['source'] as string | undefined,
      path: argv['path'] as string | undefined,
      scope: argv['scope'] as Scope | undefined,
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
