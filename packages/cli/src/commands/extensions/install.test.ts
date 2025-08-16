/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installExtension } from './install.js';
import { SettingsManager } from '../../config/settings-manager.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';

vi.mock('fs');
vi.mock('../../config/settings-manager.js');
vi.mock('child_process');

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>();
  return {
    ...os,
    homedir: vi.fn(),
  };
});

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;
const mockedFs = vi.mocked(fs);
const mockedChildProcess = vi.mocked(child_process);

describe('extensions install command', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = '/tmp/gemini-cli-test-';
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    mockedFs.mkdtempSync.mockReturnValue(path.join(tempDir, 'gemini-cli-ext-'));
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.rmSync.mockImplementation(() => {});
    mockedFs.mkdirSync.mockImplementation(() => {});
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.cpSync.mockImplementation(() => {});
  });

  afterEach(() => {
    // No need to clean up tempDir since fs is mocked
  });

  it('should install an extension from a local path', async () => {
    const mockAddExtension = vi.fn();
    MockedSettingsManager.prototype.addExtension = mockAddExtension;
    const extensionPath = path.join(tempDir, 'my-extension');

    mockedFs.existsSync.mockImplementation((p) => {
      if (p === extensionPath) return true;
      if (p === path.join(extensionPath, 'gemini-extension.json')) return true;
      return false;
    });

    mockedFs.promises.readFile.mockResolvedValue(
      JSON.stringify({ name: 'my-extension' }),
    );

    await installExtension({
      source: extensionPath,
      project: false,
      user: true,
    });

    expect(mockAddExtension).toHaveBeenCalledWith({
      name: 'my-extension',
      source: path.join(tempDir, '.gemini', 'extensions', 'my-extension'),
      installDate: expect.any(String),
      lastUpdated: expect.any(String),
      active: true,
      scope: 'user',
    });
  });

  it('should install an extension from a git repository', async () => {
    const mockAddExtension = vi.fn();
    MockedSettingsManager.prototype.addExtension = mockAddExtension;
    const gitUrl = 'https://github.com/gemini/gemini-extension.git';
    const extensionName = 'gemini-extension';
    const tempGitDir = path.join(tempDir, 'gemini-cli-ext-git');

    mockedFs.mkdtempSync.mockReturnValue(tempGitDir);
    mockedFs.existsSync.mockImplementation((p) => {
      if (p === gitUrl) return false;
      if (p === tempGitDir) return true;
      if (p === path.join(tempGitDir, 'gemini-extension.json')) return true;
      return false;
    });
    mockedFs.promises.readFile.mockResolvedValue(
      JSON.stringify({ name: extensionName }),
    );

    await installExtension({
      source: gitUrl,
      project: false,
      user: true,
    });

    expect(mockedChildProcess.execSync).toHaveBeenCalledWith(
      `git clone ${gitUrl} .`,
      {
        cwd: tempGitDir,
        stdio: 'inherit',
      },
    );

    expect(mockAddExtension).toHaveBeenCalledWith({
      name: extensionName,
      source: gitUrl,
      installDate: expect.any(String),
      lastUpdated: expect.any(String),
      active: true,
      scope: 'user',
    });
  });
});
