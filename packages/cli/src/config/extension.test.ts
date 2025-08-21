/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EXTENSIONS_CONFIG_FILENAME,
  annotateActiveExtensions,
  installExtension,
  loadExtensions,
} from './extension.js';
import { execSync } from 'child_process';
import * as settings from './settings.js';
import { LoadedSettings } from './settings.js';

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>();
  return {
    ...os,
    homedir: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('./settings.js', () => ({
  loadSettings: vi.fn(),
  SettingScope: {
    User: 'user',
  },
}));

const EXTENSIONS_DIRECTORY_NAME = path.join('.gemini', 'extensions');

describe('loadExtensions', () => {
  let tempWorkspaceDir: string;
  let tempHomeDir: string;

  beforeEach(() => {
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-workspace-'),
    );
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
  });

  afterEach(() => {
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it('should include extension path in loaded extension', () => {
    const workspaceExtensionsDir = path.join(
      tempWorkspaceDir,
      EXTENSIONS_DIRECTORY_NAME,
    );
    fs.mkdirSync(workspaceExtensionsDir, { recursive: true });

    const extensionDir = path.join(workspaceExtensionsDir, 'test-extension');
    fs.mkdirSync(extensionDir, { recursive: true });

    const config = {
      name: 'test-extension',
      version: '1.0.0',
    };
    fs.writeFileSync(
      path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify(config),
    );

    const extensions = loadExtensions(tempWorkspaceDir);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].path).toBe(extensionDir);
    expect(extensions[0].config.name).toBe('test-extension');
  });

  it('should load context file path when GEMINI.md is present', () => {
    const workspaceExtensionsDir = path.join(
      tempWorkspaceDir,
      EXTENSIONS_DIRECTORY_NAME,
    );
    fs.mkdirSync(workspaceExtensionsDir, { recursive: true });
    createExtension(workspaceExtensionsDir, 'ext1', '1.0.0', true);
    createExtension(workspaceExtensionsDir, 'ext2', '2.0.0');

    const extensions = loadExtensions(tempWorkspaceDir);

    expect(extensions).toHaveLength(2);
    const ext1 = extensions.find((e) => e.config.name === 'ext1');
    const ext2 = extensions.find((e) => e.config.name === 'ext2');
    expect(ext1?.contextFiles).toEqual([
      path.join(workspaceExtensionsDir, 'ext1', 'GEMINI.md'),
    ]);
    expect(ext2?.contextFiles).toEqual([]);
  });

  it('should load context file path from the extension config', () => {
    const workspaceExtensionsDir = path.join(
      tempWorkspaceDir,
      EXTENSIONS_DIRECTORY_NAME,
    );
    fs.mkdirSync(workspaceExtensionsDir, { recursive: true });
    createExtension(
      workspaceExtensionsDir,
      'ext1',
      '1.0.0',
      false,
      'my-context-file.md',
    );

    const extensions = loadExtensions(tempWorkspaceDir);

    expect(extensions).toHaveLength(1);
    const ext1 = extensions.find((e) => e.config.name === 'ext1');
    expect(ext1?.contextFiles).toEqual([
      path.join(workspaceExtensionsDir, 'ext1', 'my-context-file.md'),
    ]);
  });
});

describe('annotateActiveExtensions', () => {
  const extensions = [
    { config: { name: 'ext1', version: '1.0.0' }, contextFiles: [] },
    { config: { name: 'ext2', version: '1.0.0' }, contextFiles: [] },
    { config: { name: 'ext3', version: '1.0.0' }, contextFiles: [] },
  ];

  it('should mark all extensions as active if no enabled extensions are provided', () => {
    const activeExtensions = annotateActiveExtensions(extensions, []);
    expect(activeExtensions).toHaveLength(3);
    expect(activeExtensions.every((e) => e.isActive)).toBe(true);
  });

  it('should mark only the enabled extensions as active', () => {
    const activeExtensions = annotateActiveExtensions(extensions, [
      'ext1',
      'ext3',
    ]);
    expect(activeExtensions).toHaveLength(3);
    expect(activeExtensions.find((e) => e.name === 'ext1')?.isActive).toBe(
      true,
    );
    expect(activeExtensions.find((e) => e.name === 'ext2')?.isActive).toBe(
      false,
    );
    expect(activeExtensions.find((e) => e.name === 'ext3')?.isActive).toBe(
      true,
    );
  });

  it('should mark all extensions as inactive when "none" is provided', () => {
    const activeExtensions = annotateActiveExtensions(extensions, ['none']);
    expect(activeExtensions).toHaveLength(3);
    expect(activeExtensions.every((e) => !e.isActive)).toBe(true);
  });

  it('should handle case-insensitivity', () => {
    const activeExtensions = annotateActiveExtensions(extensions, ['EXT1']);
    expect(activeExtensions.find((e) => e.name === 'ext1')?.isActive).toBe(
      true,
    );
  });

  it('should log an error for unknown extensions', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    annotateActiveExtensions(extensions, ['ext4']);
    expect(consoleSpy).toHaveBeenCalledWith('Extension not found: ext4');
    consoleSpy.mockRestore();
  });
});

describe('installExtension', () => {
  let tempWorkspaceDir: string;
  let tempHomeDir: string;
  let userExtensionsDir: string;
  const mockSettings = {
    forScope: vi.fn(),
    setValue: vi.fn(),
  };
  const mockSettingsFile = {
    settings: {
      activatedExtensions: [] as string[],
    },
  };

  beforeEach(() => {
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-workspace-'),
    );
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
    userExtensionsDir = path.join(tempHomeDir, '.gemini', 'extensions');

    vi.mocked(settings.loadSettings).mockReturnValue(
      mockSettings as unknown as LoadedSettings,
    );
    mockSettings.forScope.mockReturnValue(mockSettingsFile);
    mockSettingsFile.settings.activatedExtensions = [];
    vi.mocked(execSync).mockClear();
    mockSettings.setValue.mockClear();
    mockSettings.forScope.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it('should install an extension from a local path', async () => {
    const sourceExtDir = path.join(tempWorkspaceDir, 'my-local-extension');
    fs.mkdirSync(sourceExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'my-local-extension', version: '1.0.0' }),
    );

    await installExtension({ path: sourceExtDir });

    const targetExtDir = path.join(userExtensionsDir, 'my-local-extension');
    expect(fs.existsSync(targetExtDir)).toBe(true);
    expect(
      fs.existsSync(path.join(targetExtDir, EXTENSIONS_CONFIG_FILENAME)),
    ).toBe(true);

    expect(settings.loadSettings).toHaveBeenCalledWith(process.cwd());
    expect(mockSettings.forScope).toHaveBeenCalledWith('user');
    expect(mockSettings.setValue).toHaveBeenCalledWith(
      'user',
      'activatedExtensions',
      ['my-local-extension'],
    );
  });

  it('should throw an error if the extension already exists', async () => {
    const sourceExtDir = path.join(tempWorkspaceDir, 'my-local-extension');
    fs.mkdirSync(sourceExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'my-local-extension', version: '1.0.0' }),
    );

    // "Install" it once by creating the directory
    fs.mkdirSync(path.join(userExtensionsDir, 'my-local-extension'), {
      recursive: true,
    });

    await expect(installExtension({ path: sourceExtDir })).rejects.toThrow(
      'Extension "my-local-extension" already exists. Please uninstall it first.',
    );
  });

  it('should throw an error and cleanup if gemini-extension.json is missing', async () => {
    const sourceExtDir = path.join(tempWorkspaceDir, 'bad-extension');
    fs.mkdirSync(sourceExtDir, { recursive: true }); // No manifest file

    await expect(installExtension({ path: sourceExtDir })).rejects.toThrow(
      'Installation failed: gemini-extension.json not found in the extension.',
    );

    const targetExtDir = path.join(userExtensionsDir, 'bad-extension');
    expect(fs.existsSync(targetExtDir)).toBe(false);
  });
});

function createExtension(
  extensionsDir: string,
  name: string,
  version: string,
  addContextFile = false,
  contextFileName?: string,
): void {
  const extDir = path.join(extensionsDir, name);
  fs.mkdirSync(extDir);
  fs.writeFileSync(
    path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
    JSON.stringify({ name, version, contextFileName }),
  );

  if (addContextFile) {
    fs.writeFileSync(path.join(extDir, 'GEMINI.md'), 'context');
  }

  if (contextFileName) {
    fs.writeFileSync(path.join(extDir, contextFileName), 'context');
  }
}
