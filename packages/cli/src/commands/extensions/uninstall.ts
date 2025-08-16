/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions uninstall' command
import type { CommandModule } from 'yargs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXTENSIONS_DIRECTORY_NAME } from '../../config/extension.js';
import { handlerWrapper } from '../handler-wrapper.js';
import { findExtensionInScopes } from '../shared-options.js';

async function uninstallExtension(argv: { name: string }) {
  const { name } = argv;

  const result = await findExtensionInScopes(name);
  if (!result) {
    console.error(`Extension "${name}" not found in user or project settings.`);
    return;
  }

  const { extension, settingsManager } = result;
  const scope = extension.scope;

  const extensionsDir =
    scope === 'user'
      ? path.join(os.homedir(), EXTENSIONS_DIRECTORY_NAME)
      : path.join(process.cwd(), EXTENSIONS_DIRECTORY_NAME);

  const targetPath = path.join(extensionsDir, path.basename(name));

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  await settingsManager.removeExtension(name);

  console.log(`Extension "${name}" removed from ${scope} settings.`);
}

export const uninstallCommand: CommandModule = {
  command: 'uninstall <name>',
  describe: 'Uninstall an extension',
  builder: (yargs) =>
    yargs.positional('name', {
      describe: 'Name of the extension to uninstall',
      type: 'string',
      demandOption: true,
    }),
  handler: handlerWrapper(
    uninstallExtension,
    'An error occurred during uninstallation',
  ),
};
