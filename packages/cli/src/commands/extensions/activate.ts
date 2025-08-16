/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions activate' command
import type { CommandModule } from 'yargs';
import { handlerWrapper } from '../handler-wrapper.js';
import { findExtensionInScopes } from '../shared-options.js';

async function activateExtension(argv: { name: string }) {
  const { name } = argv;

  const result = await findExtensionInScopes(name);
  if (!result) {
    console.error(
      `Error: Extension "${name}" is not installed or not managed by the CLI.`,
    );
    return;
  }

  const { extension, settingsManager } = result;

  if (extension.active) {
    console.log(`Extension "${name}" is already active.`);
    return;
  }

  extension.active = true;
  await settingsManager.updateExtension(extension);

  console.log(`Extension "${name}" activated.`);
}

export const activateCommand: CommandModule = {
  command: 'activate <name>',
  describe: 'Activate an extension',
  builder: (yargs) =>
    yargs.positional('name', {
      describe: 'Name of the extension to activate',
      type: 'string',
      demandOption: true,
    }),
  handler: handlerWrapper(
    activateExtension,
    'An error occurred during activation',
  ),
};
