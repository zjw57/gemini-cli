/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions install' command
import type { CommandModule } from 'yargs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  SettingsManager,
  ExtensionMetadata,
} from '../../config/settings-manager.js';
import {
  EXTENSIONS_DIRECTORY_NAME,
  EXTENSIONS_CONFIG_FILENAME,
} from '../../config/extension.js';
import { getScope } from '../../utils/scope.js';
import { handlerWrapper } from '../handler-wrapper.js';

async function getExtensionName(extensionDir: string): Promise<string> {
  const configPath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Extension config file not found at ${configPath}`);
  }
  const configContent = await fs.promises.readFile(configPath, 'utf-8');
  const config = JSON.parse(configContent);
  if (!config.name) {
    throw new Error(`Extension name not found in ${configPath}`);
  }
  return config.name;
}

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

export async function installExtension(argv: {
  source: string;
  project?: boolean;
  user?: boolean;
}) {
  const { source } = argv;
  const scope = getScope(argv);

  let sourcePath: string;
  let tempDir: string | undefined;
  let isLocalPath = false;

  try {
    // Check if the source is a local path
    if (fs.existsSync(source)) {
      sourcePath = path.resolve(source);
      isLocalPath = true;
      console.log(`Installing local extension from ${sourcePath}...`);
    } else if (isGitUrl(source)) {
      // It's a git repository
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-cli-ext-'));
      console.log(`Cloning from ${source} into ${tempDir}...`);
      execSync(`git clone ${source} .`, { cwd: tempDir, stdio: 'inherit' });
      sourcePath = tempDir;
    } else {
      throw new Error(
        `Invalid source: "${source}". Must be a local path or git URL.`,
      );
    }

    const extensionName = await getExtensionName(sourcePath);

    const extensionsDir =
      scope === 'user'
        ? path.join(os.homedir(), EXTENSIONS_DIRECTORY_NAME)
        : path.join(process.cwd(), EXTENSIONS_DIRECTORY_NAME);

    if (!fs.existsSync(extensionsDir)) {
      fs.mkdirSync(extensionsDir, { recursive: true });
    }

    const targetPath = path.join(extensionsDir, extensionName);

    if (fs.existsSync(targetPath)) {
      console.error(
        `Extension "${extensionName}" is already configured within the ${scope} scope.`,
      );
      return;
    }

    fs.cpSync(sourcePath, targetPath, { recursive: true });

    const settingsManager = new SettingsManager(scope);
    const metadata: ExtensionMetadata = {
      name: extensionName,
      source: isLocalPath ? targetPath : source,
      installDate: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      active: true,
      scope,
    };

    await settingsManager.addExtension(metadata);

    console.log(`Extension "${extensionName}" installed in ${scope} scope.`);
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export const installCommand: CommandModule = {
  command: 'install <source>',
  describe: 'Install an extension from a Git URL or local path',
  builder: (yargs) =>
    yargs
      .positional('source', {
        describe: 'Git URL or local path of the extension to install',
        type: 'string',
        demandOption: true,
      })
      .option('project', {
        describe: 'Install the extension in the project scope',
        type: 'boolean',
      })
      .option('user', {
        describe: 'Install the extension in the user scope',
        type: 'boolean',
      }),
  handler: handlerWrapper(
    installExtension,
    'An error occurred during installation',
  ),
};
