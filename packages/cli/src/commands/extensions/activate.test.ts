/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import yargs from 'yargs';
import { activateCommand } from './activate.js';
import { SettingsManager } from '../../config/settings-manager.js';

vi.mock('../../config/settings-manager.js');

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;

describe('extensions activate command', () => {
  let parser: yargs.Argv;

  beforeEach(() => {
    vi.resetAllMocks();
    const yargsInstance = yargs([]).command(activateCommand);
    parser = yargsInstance;
  });

  it('should activate an extension', async () => {
    const mockUpdateExtension = vi.fn();
    MockedSettingsManager.prototype.updateExtension = mockUpdateExtension;
    MockedSettingsManager.prototype.getExtension = vi.fn().mockResolvedValue({
      name: 'my-extension',
      active: false,
    });

    await parser.parseAsync('activate my-extension');

    expect(mockUpdateExtension).toHaveBeenCalledWith({
      name: 'my-extension',
      active: true,
    });
  });

  it('should show a message if extension is already active', async () => {
    const mockUpdateExtension = vi.fn();
    MockedSettingsManager.prototype.updateExtension = mockUpdateExtension;
    MockedSettingsManager.prototype.getExtension = vi.fn().mockResolvedValue({
      name: 'my-extension',
      active: true,
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await parser.parseAsync('activate my-extension');

    expect(mockUpdateExtension).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Extension "my-extension" is already active.',
    );
  });
});

export {};
