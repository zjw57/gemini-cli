/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import yargs from 'yargs';
import { deactivateCommand } from './deactivate.js';
import { SettingsManager } from '../../config/settings-manager.js';

vi.mock('../../config/settings-manager.js');

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;

describe('extensions deactivate command', () => {
  let parser: yargs.Argv;

  beforeEach(() => {
    vi.resetAllMocks();
    const yargsInstance = yargs([]).command(deactivateCommand);
    parser = yargsInstance;
  });

  it('should deactivate an extension', async () => {
    const mockUpdateExtension = vi.fn();
    MockedSettingsManager.prototype.updateExtension = mockUpdateExtension;
    MockedSettingsManager.prototype.getExtension = vi.fn().mockResolvedValue({
      name: 'my-extension',
      active: true,
    });

    await parser.parseAsync('deactivate my-extension');

    expect(mockUpdateExtension).toHaveBeenCalledWith({
      name: 'my-extension',
      active: false,
    });
  });

  it('should show a message if extension is already inactive', async () => {
    const mockUpdateExtension = vi.fn();
    MockedSettingsManager.prototype.updateExtension = mockUpdateExtension;
    MockedSettingsManager.prototype.getExtension = vi.fn().mockResolvedValue({
      name: 'my-extension',
      active: false,
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await parser.parseAsync('deactivate my-extension');

    expect(mockUpdateExtension).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Extension "my-extension" is already inactive.',
    );
  });
});

export {};
