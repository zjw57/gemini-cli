/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions update' command
import type { CommandModule } from 'yargs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { EXTENSIONS_DIRECTORY_NAME } from '../../config/extension.js';
import { handlerWrapper } from '../handler-wrapper.js';
import { findExtensionInScopes } from '../shared-options.js';

function isGitUrl(source: string): boolean {
  return (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@') ||
    source.includes('github.com') ||
    source.includes('gitlab.com') ||
    source.includes('bitbucket.org') ||
    source.endsWith('.git')
  );
}

async function updateExtension(argv: { name: string }) {
  const { name } = argv;

  const result = await findExtensionInScopes(name);
  if (!result) {
    console.error(`Extension "${name}" not found.`);
    return;
  }

  const { extension, settingsManager } = result;

  const extensionsDir =
    extension.scope === 'user'
      ? path.join(os.homedir(), EXTENSIONS_DIRECTORY_NAME)
      : path.join(process.cwd(), EXTENSIONS_DIRECTORY_NAME);

  const targetPath = path.join(extensionsDir, path.basename(name));

  if (!fs.existsSync(targetPath)) {
    console.error(
      `Error: Extension "${name}" is not found at the expected path: ${targetPath}`,
    );
    return;
  }

  console.log(`Updating extension "${name}"...`);

  if (isGitUrl(extension.source)) {
    // Git source - only update if it's still a git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: targetPath,
        stdio: 'pipe',
      });
      execSync('git pull', { cwd: targetPath, stdio: 'inherit' });
    } catch {
      console.error(
        `Error: Extension "${name}" is not a valid git repository for updating.`,
      );
      return;
    }
  } else {
    // Local path source - warn user that local extensions can't be auto-updated
    console.log(
      `Extension "${name}" was installed from a local path and cannot be automatically updated.`,
    );
    console.log(
      `To update, you'll need to manually replace the files or reinstall from the source.`,
    );
    return;
  }

  extension.lastUpdated = new Date().toISOString();
  await settingsManager.updateExtension(extension);

  console.log(`Extension "${name}" updated.`);
}

export const updateCommand: CommandModule = {
  command: 'update <name>',
  describe: 'Update an extension',
  builder: (yargs) =>
    yargs.positional('name', {
      describe: 'Name of the extension to update',
      type: 'string',
      demandOption: true,
    }),
  handler: handlerWrapper(updateExtension, 'An error occurred during update'),
};
