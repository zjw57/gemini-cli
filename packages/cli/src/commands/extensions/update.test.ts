/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import yargs from 'yargs';
import { updateCommand } from './update.js';
import { SettingsManager } from '../../config/settings-manager.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('../../config/settings-manager.js');
vi.mock('child_process');
vi.mock('fs');

vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof os>();
  return {
    ...actualOs,
    homedir: vi.fn(() => '/tmp'),
  };
});

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;
const mockedExecSync = execSync as vi.Mock;
const mockedExistsSync = fs.existsSync as vi.Mock;

describe('extensions update command', () => {
  let parser: yargs.Argv;

  beforeEach(() => {
    vi.resetAllMocks();
    const yargsInstance = yargs([]).command(updateCommand);
    parser = yargsInstance;
  });

  it('should update a git-based extension', async () => {
    const mockUpdateExtension = vi.fn();
    MockedSettingsManager.prototype.updateExtension = mockUpdateExtension;
    MockedSettingsManager.prototype.getExtension = vi.fn().mockResolvedValue({
      name: 'my-extension',
      source: 'https://github.com/some/repo.git',
      scope: 'user',
    });
    mockedExistsSync.mockReturnValue(true);

    await parser.parseAsync('update my-extension');

    expect(mockedExecSync).toHaveBeenCalledWith('git pull', {
      cwd: expect.any(String),
      stdio: 'inherit',
    });
    expect(mockUpdateExtension).toHaveBeenCalledWith({
      name: 'my-extension',
      source: 'https://github.com/some/repo.git',
      scope: 'user',
      lastUpdated: expect.any(String),
    });
  });
});

export {};
