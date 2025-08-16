/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions' command
import type { CommandModule, Argv } from 'yargs';
import { installCommand } from './extensions/install.js';
import { uninstallCommand } from './extensions/uninstall.js';
import { listCommand } from './extensions/list.js';
import { activateCommand } from './extensions/activate.js';
import { deactivateCommand } from './extensions/deactivate.js';
import { updateCommand } from './extensions/update.js';

export const extensionsCommand: CommandModule = {
  command: 'extensions',
  describe: 'Manage Gemini CLI extensions',
  builder: (yargs: Argv) =>
    yargs
      .command(installCommand)
      .command(uninstallCommand)
      .command(listCommand)
      .command(activateCommand)
      .command(deactivateCommand)
      .command(updateCommand)
      .demandCommand(1, 'You need at least one command before continuing.')
      .version(false),
  handler: () => {
    // yargs will automatically show help if no subcommand is provided
    // thanks to demandCommand(1) in the builder.
  },
};
