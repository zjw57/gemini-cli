/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import yargs from 'yargs';
import { uninstallCommand } from './uninstall.js';
import { SettingsManager } from '../../config/settings-manager.js';

vi.mock('../../config/settings-manager.js');

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;

describe('extensions uninstall command', () => {
  let parser: yargs.Argv;

  beforeEach(() => {
    vi.resetAllMocks();
    const yargsInstance = yargs([]).command(uninstallCommand);
    parser = yargsInstance;
  });

  it('should uninstall an extension', async () => {
    const mockRemoveExtension = vi.fn();
    MockedSettingsManager.prototype.removeExtension = mockRemoveExtension;
    MockedSettingsManager.prototype.getExtension = vi.fn().mockResolvedValue({
      name: 'my-extension',
      scope: 'user',
    });

    await parser.parseAsync('uninstall my-extension');

    expect(mockRemoveExtension).toHaveBeenCalledWith('my-extension');
  });

  it('should show a message if extension not found', async () => {
    const mockRemoveExtension = vi.fn();
    MockedSettingsManager.prototype.removeExtension = mockRemoveExtension;
    MockedSettingsManager.prototype.getExtension = vi
      .fn()
      .mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await parser.parseAsync('uninstall non-existent-extension');

    expect(mockRemoveExtension).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Extension "non-existent-extension" not found in user or project settings.',
    );
  });
});

export {};
