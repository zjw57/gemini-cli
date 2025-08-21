/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { handleInstall } from './install.js';

// Mock dependencies
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/mock/home/user'),
    platform: vi.fn(() => 'linux'),
  },
  homedir: vi.fn(() => '/mock/home/user'),
  platform: vi.fn(() => 'linux'),
}));

vi.mock('../../config/settings', () => ({
  loadSettings: vi.fn(() => ({
    forScope: () => ({
      settings: {
        activatedExtensions: [],
      },
    }),
    setValue: vi.fn(),
  })),
  SettingScope: {
    User: 'User',
    Workspace: 'Workspace',
  },
}));

vi.mock('fs/promises');
vi.mock('child_process');

describe('extensions install', () => {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as any);

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Mock fs.mkdir to simulate directory creation
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.cp).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    // Mock fs.stat to simulate checking for file/dir existence
    // Default to not found
    vi.mocked(fs.stat).mockRejectedValue({ code: 'ENOENT' });
  });

  afterEach(() => {
    mockExit.mockClear();
  });

  it('should install from a git url', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(fs.stat).mockImplementation(async (p) => {
      if (p.toString().endsWith('gemini-extension.json')) {
        return { isFile: () => true } as any;
      }
      throw { code: 'ENOENT' };
    });

    await handleInstall({
      source: 'https://github.com/google/add-copyright.git',
    });

    expect(fs.mkdir).toHaveBeenCalledWith(
      '/mock/home/user/.gemini/extensions',
      {
        recursive: true,
      },
    );
    expect(execSync).toHaveBeenCalledWith(
      'git clone --depth 1 https://github.com/google/add-copyright.git /mock/home/user/.gemini/extensions/add-copyright',
      { stdio: 'inherit' },
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "add-copyright" installed successfully.',
    );
  });

  it('should install from a local path', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sourcePath = '/tmp/my-local-extension';
    vi.mocked(fs.stat).mockImplementation(async (p) => {
      if (p.toString().endsWith('gemini-extension.json')) {
        return { isFile: () => true } as any;
      }
      throw { code: 'ENOENT' };
    });

    await handleInstall({ path: sourcePath });

    expect(fs.mkdir).toHaveBeenCalledWith(
      '/mock/home/user/.gemini/extensions',
      {
        recursive: true,
      },
    );
    expect(fs.cp).toHaveBeenCalledWith(
      sourcePath,
      '/mock/home/user/.gemini/extensions/my-local-extension',
      { recursive: true },
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "my-local-extension" installed successfully.',
    );
  });

  it('should fail if extension already exists', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Simulate directory already exists
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);

    try {
      await handleInstall({
        source: 'https://github.com/google/add-copyright.git',
      });
    } catch (e) {
      // ignore
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Extension "add-copyright" already exists. Please uninstall it first.',
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should fail if gemini-extension.json is missing', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const sourcePath = '/tmp/bad-extension';

    // Simulate fs.stat failing for the manifest check
    vi.mocked(fs.stat).mockImplementation(async (p) => {
      if (p.toString().endsWith('gemini-extension.json')) {
        throw { code: 'ENOENT' };
      }
      // For the directory check, say it doesn't exist so we proceed to copy
      return { isDirectory: () => false } as any;
    });

    try {
      await handleInstall({ path: sourcePath });
    } catch (e) {
      // ignore
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Installation failed: gemini-extension.json not found in the extension.',
    );
    expect(fs.rm).toHaveBeenCalledWith(
      '/mock/home/user/.gemini/extensions/bad-extension',
      { recursive: true, force: true },
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
