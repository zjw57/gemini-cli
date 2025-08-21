/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { URL } from 'url';
import { SettingScope, loadSettings } from '../../config/settings.js';

interface InstallArgs {
  source?: string;
  path?: string;
  scope?: SettingScope;
}

async function directoryExists(path: string) {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw e;
  }
}

async function fileExists(path: string) {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw e;
  }
}

export async function handleInstall(args: InstallArgs) {
  const { scope = SettingScope.User } = args;

  if (scope !== SettingScope.User && scope !== SettingScope.Workspace) {
    console.error(
      'Only user and project scopes are supported for installation.',
    );
    process.exit(1);
  }

  const extensionsDir = path.join(os.homedir(), '.gemini', 'extensions');
  await fs.mkdir(extensionsDir, { recursive: true });

  let extensionName: string;
  let targetPath: string;

  if (args.source) {
    try {
      const url = new URL(args.source);
      extensionName = path.basename(url.pathname, '.git');
    } catch (_e) {
      console.error(`Invalid git URL: ${args.source}`);
      process.exit(1);
    }
    targetPath = path.join(extensionsDir, extensionName);

    if (await directoryExists(targetPath)) {
      console.error(
        `Extension "${extensionName}" already exists. Please uninstall it first.`,
      );
      process.exit(1);
    }

    try {
      execSync(`git clone --depth 1 ${args.source} ${targetPath}`, {
        stdio: 'inherit',
      });
    } catch (error) {
      console.error(`Failed to clone repository: ${(error as Error).message}`);
      process.exit(1);
    }
  } else if (args.path) {
    // Local path
    const sourcePath = path.resolve(args.path);
    extensionName = path.basename(sourcePath);
    targetPath = path.join(extensionsDir, extensionName);

    if (await directoryExists(targetPath)) {
      console.error(
        `Extension "${extensionName}" already exists. Please uninstall it first.`,
      );
      process.exit(1);
    }

    try {
      await fs.cp(sourcePath, targetPath, { recursive: true });
    } catch (error) {
      console.error(`Failed to copy directory: ${(error as Error).message}`);
      process.exit(1);
    }
  } else {
    // This case should be prevented by yargs configuration
    console.error('Either a git URL source or a --path must be provided.');
    process.exit(1);
  }

  // Verify gemini-extension.json
  const manifestPath = path.join(targetPath, 'gemini-extension.json');
  if (!(await fileExists(manifestPath))) {
    console.error(
      'Installation failed: gemini-extension.json not found in the extension.',
    );
    // Clean up installed directory
    await fs.rm(targetPath, { recursive: true, force: true });
    process.exit(1);
  }

  const settings = loadSettings(process.cwd());
  const settingsFile = settings.forScope(scope);
  const activatedExtensions = settingsFile.settings.activatedExtensions || [];
  if (!activatedExtensions.includes(extensionName)) {
    activatedExtensions.push(extensionName);
    settings.setValue(scope, 'activatedExtensions', activatedExtensions);
  }

  console.log(`Extension "${extensionName}" installed successfully.`);
}
