/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions deactivate' command
import type { CommandModule } from 'yargs';
import { handlerWrapper } from '../handler-wrapper.js';
import { findExtensionInScopes } from '../shared-options.js';

async function deactivateExtension(argv: { name: string }) {
  const { name } = argv;

  const result = await findExtensionInScopes(name);
  if (!result) {
    console.error(
      `Error: Extension "${name}" is not installed or not managed by the CLI.`,
    );
    return;
  }

  const { extension, settingsManager } = result;

  if (!extension.active) {
    console.log(`Extension "${name}" is already inactive.`);
    return;
  }

  extension.active = false;
  await settingsManager.updateExtension(extension);

  console.log(`Extension "${name}" deactivated.`);
}

export const deactivateCommand: CommandModule = {
  command: 'deactivate <name>',
  describe: 'Deactivate an extension',
  builder: (yargs) =>
    yargs.positional('name', {
      describe: 'Name of the extension to deactivate',
      type: 'string',
      demandOption: true,
    }),
  handler: handlerWrapper(
    deactivateExtension,
    'An error occurred during deactivation',
  ),
};
