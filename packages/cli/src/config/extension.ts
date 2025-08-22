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
import { URL } from 'url';
import { simpleGit } from 'simple-git';
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
  githubUrl?: string;
  installPath?: string;
}

export class ExtensionStorage {
  private readonly extensionName: string;

  constructor(extensionName: string) {
    this.extensionName = extensionName;
  }

  static getUserExtensionsDir(): string {
    const storage = new Storage(os.homedir());
    return storage.getExtensionsDir();
  }

  getExtensionDir(): string {
    return path.join(
      ExtensionStorage.getUserExtensionsDir(),
      this.extensionName,
    );
  }

  getConfigPath(): string {
    return path.join(this.getExtensionDir(), EXTENSIONS_CONFIG_FILENAME);
  }

  static getSettingsPath(): string {
    return process.cwd();
  }
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
  const extensionsDir = ExtensionStorage.getUserExtensionsDir();
  await fs.promises.mkdir(extensionsDir, { recursive: true });

  let extensionName: string;

  if (args.source) {
    try {
      const url = new URL(args.source);
      extensionName = path.basename(url.pathname, '.git');
    } catch (_e) {
      throw new Error(`Invalid git URL: ${args.source}`);
    }
  } else if (args.path) {
    const sourcePath = path.resolve(args.path);
    extensionName = path.basename(sourcePath);
  } else {
    // This case should be prevented by yargs configuration
    throw new Error('Either a git URL source or a --path must be provided.');
  }

  const extensionStorage = new ExtensionStorage(extensionName);
  const targetPath = extensionStorage.getExtensionDir();
  const manifestPath = extensionStorage.getConfigPath();

  if (await fileOrDirectoryExists(targetPath)) {
    throw new Error(
      `Extension "${extensionName}" already exists. Please uninstall it first.`,
    );
  }

  if (args.source) {
    try {
      await simpleGit().clone(args.source, targetPath, ['--depth', '1']);
    } catch (error) {
      throw new Error(
        `Failed to clone repository: ${(error as Error).message}`,
      );
    }
    // Add githubUrl to manifest
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf-8'),
    );
    manifest.githubUrl = args.source;
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
    );
  } else if (args.path) {
    // Local path
    const sourcePath = path.resolve(args.path);
    try {
      await fs.promises.symlink(sourcePath, targetPath, 'dir');
    } catch (error) {
      throw new Error(`Failed to create symlink: ${(error as Error).message}`);
    }
    // Add installPath to manifest
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf-8'),
    );
    manifest.installPath = sourcePath;
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
    );
  }

  // Verify manfiest file
  if (!(await fileOrDirectoryExists(manifestPath))) {
    // Clean up installed directory
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    throw new Error(
      `Installation failed: ${EXTENSIONS_CONFIG_FILENAME} not found in the extension.`,
    );
  }

  // Check if the extension is already installed by comparing
  // ExtensionConfig.name. This is more robust than checking for file path
  // uniqueness.
  const installedExtensions = loadExtensionsFromDir(os.homedir());
  const newExtension = loadExtension(targetPath);
  if (!newExtension) {
    // Clean up installed directory
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    throw new Error(
      `Invalid extension at ${
        args.source || args.path
      }. Please make sure it has a valid gemini-extension.json file.`,
    );
  }

  if (
    installedExtensions.some(
      (installed) => installed.config.name === newExtension.config.name,
    )
  ) {
    // Clean up installed directory
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    // Since an extension with the same name exists, the command fails and
    // informs the user they need to uninstall it first or use the update
    // command.
    throw new Error(
      `Error: Extension "${newExtension.config.name}" is already installed. Please uninstall it first.`,
    );
  }

  const settings = loadSettings(ExtensionStorage.getSettingsPath());
  const settingsFile = settings.forScope(SettingScope.User);
  const activatedExtensions = settingsFile.settings.activatedExtensions || [];
  if (!activatedExtensions.includes(extensionName)) {
    activatedExtensions.push(extensionName);
    settings.setValue(
      SettingScope.User,
      'activatedExtensions',
      activatedExtensions,
    );
  }

  return extensionName;
}
