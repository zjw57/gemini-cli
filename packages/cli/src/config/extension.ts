/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MCPServerConfig,
  GeminiCLIExtension,
  Storage,
} from '@google/gemini-cli-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { URL } from 'url';
import { SettingScope, loadSettings } from './settings.js';

export const EXTENSIONS_CONFIG_FILENAME = 'gemini-extension.json';

export interface Extension {
  path: string;
  config: ExtensionConfig;
  contextFiles: string[];
}

export interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
}

export function loadExtensions(workspaceDir: string): Extension[] {
  const allExtensions = [
    ...loadExtensionsFromDir(workspaceDir),
    ...loadExtensionsFromDir(os.homedir()),
  ];

  const uniqueExtensions = new Map<string, Extension>();
  for (const extension of allExtensions) {
    if (!uniqueExtensions.has(extension.config.name)) {
      uniqueExtensions.set(extension.config.name, extension);
    }
  }

  return Array.from(uniqueExtensions.values());
}

function loadExtensionsFromDir(dir: string): Extension[] {
  const storage = new Storage(dir);
  const extensionsDir = storage.getExtensionsDir();
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }

  const extensions: Extension[] = [];
  for (const subdir of fs.readdirSync(extensionsDir)) {
    const extensionDir = path.join(extensionsDir, subdir);

    const extension = loadExtension(extensionDir);
    if (extension != null) {
      extensions.push(extension);
    }
  }
  return extensions;
}

function loadExtension(extensionDir: string): Extension | null {
  if (!fs.statSync(extensionDir).isDirectory()) {
    console.error(
      `Warning: unexpected file ${extensionDir} in extensions directory.`,
    );
    return null;
  }

  const configFilePath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);
  if (!fs.existsSync(configFilePath)) {
    console.error(
      `Warning: extension directory ${extensionDir} does not contain a config file ${configFilePath}.`,
    );
    return null;
  }

  try {
    const configContent = fs.readFileSync(configFilePath, 'utf-8');
    const config = JSON.parse(configContent) as ExtensionConfig;
    if (!config.name || !config.version) {
      console.error(
        `Invalid extension config in ${configFilePath}: missing name or version.`,
      );
      return null;
    }

    const contextFiles = getContextFileNames(config)
      .map((contextFileName) => path.join(extensionDir, contextFileName))
      .filter((contextFilePath) => fs.existsSync(contextFilePath));

    return {
      path: extensionDir,
      config,
      contextFiles,
    };
  } catch (e) {
    console.error(
      `Warning: error parsing extension config in ${configFilePath}: ${e}`,
    );
    return null;
  }
}

function getContextFileNames(config: ExtensionConfig): string[] {
  if (!config.contextFileName) {
    return ['GEMINI.md'];
  } else if (!Array.isArray(config.contextFileName)) {
    return [config.contextFileName];
  }
  return config.contextFileName;
}

export function annotateActiveExtensions(
  extensions: Extension[],
  enabledExtensionNames: string[],
): GeminiCLIExtension[] {
  const annotatedExtensions: GeminiCLIExtension[] = [];

  if (enabledExtensionNames.length === 0) {
    return extensions.map((extension) => ({
      name: extension.config.name,
      version: extension.config.version,
      isActive: true,
      path: extension.path,
    }));
  }

  const lowerCaseEnabledExtensions = new Set(
    enabledExtensionNames.map((e) => e.trim().toLowerCase()),
  );

  if (
    lowerCaseEnabledExtensions.size === 1 &&
    lowerCaseEnabledExtensions.has('none')
  ) {
    return extensions.map((extension) => ({
      name: extension.config.name,
      version: extension.config.version,
      isActive: false,
      path: extension.path,
    }));
  }

  const notFoundNames = new Set(lowerCaseEnabledExtensions);

  for (const extension of extensions) {
    const lowerCaseName = extension.config.name.toLowerCase();
    const isActive = lowerCaseEnabledExtensions.has(lowerCaseName);

    if (isActive) {
      notFoundNames.delete(lowerCaseName);
    }

    annotatedExtensions.push({
      name: extension.config.name,
      version: extension.config.version,
      isActive,
      path: extension.path,
    });
  }

  for (const requestedName of notFoundNames) {
    console.error(`Extension not found: ${requestedName}`);
  }

  return annotatedExtensions;
}

function getUserExtensionsDir(): string {
  const storage = new Storage(os.homedir());
  return storage.getExtensionsDir();
}

export interface InstallArgs {
  source?: string;
  path?: string;
  scope?: SettingScope;
}

async function fileOrDirectoryExists(path: string): Promise<boolean> {
  try {
    await fs.promises.stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw e;
  }
}

export async function installExtension(args: InstallArgs): Promise<string> {
  const { scope = SettingScope.User } = args;

  if (scope !== SettingScope.User && scope !== SettingScope.Workspace) {
    throw new Error(
      'Only user and project scopes are supported for installation.',
    );
  }

  const extensionsDir = getUserExtensionsDir();
  await fs.promises.mkdir(extensionsDir, { recursive: true });

  let extensionName: string;
  let targetPath: string;

  if (args.source) {
    try {
      const url = new URL(args.source);
      extensionName = path.basename(url.pathname, '.git');
    } catch (_e) {
      throw new Error(`Invalid git URL: ${args.source}`);
    }
    targetPath = path.join(extensionsDir, extensionName);

    if (await fileOrDirectoryExists(targetPath)) {
      throw new Error(
        `Extension "${extensionName}" already exists. Please uninstall it first.`,
      );
    }

    try {
      execSync(`git clone --depth 1 ${args.source} ${targetPath}`, {
        stdio: 'inherit',
      });
    } catch (error) {
      throw new Error(
        `Failed to clone repository: ${(error as Error).message}`,
      );
    }
  } else if (args.path) {
    // Local path
    const sourcePath = path.resolve(args.path);
    extensionName = path.basename(sourcePath);
    targetPath = path.join(extensionsDir, extensionName);

    if (await fileOrDirectoryExists(targetPath)) {
      throw new Error(
        `Extension "${extensionName}" already exists. Please uninstall it first.`,
      );
    }

    try {
      await fs.promises.cp(sourcePath, targetPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to copy directory: ${(error as Error).message}`);
    }
  } else {
    // This case should be prevented by yargs configuration
    throw new Error('Either a git URL source or a --path must be provided.');
  }

  // Verify gemini-extension.json
  const manifestPath = path.join(targetPath, 'gemini-extension.json');
  if (!(await fileOrDirectoryExists(manifestPath))) {
    // Clean up installed directory
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    throw new Error(
      'Installation failed: gemini-extension.json not found in the extension.',
    );
  }

  const settings = loadSettings(process.cwd());
  const settingsFile = settings.forScope(scope);
  const activatedExtensions = settingsFile.settings.activatedExtensions || [];
  if (!activatedExtensions.includes(extensionName)) {
    activatedExtensions.push(extensionName);
    settings.setValue(scope, 'activatedExtensions', activatedExtensions);
  }

  return extensionName;
}
