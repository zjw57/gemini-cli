/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import yargs from 'yargs';
import { removeCommand } from './remove.js';
import { SettingsManager } from '../../config/settings-manager.js';

vi.mock('../../config/settings-manager.js');

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;

describe('mcp remove command', () => {
  let parser: yargs.Argv;

  beforeEach(() => {
    vi.resetAllMocks();
    const yargsInstance = yargs([]).command(removeCommand);
    parser = yargsInstance;
  });

  it('should remove a server from project settings', async () => {
    const mockRemoveMcpServer = vi.fn();
    MockedSettingsManager.prototype.removeMcpServer = mockRemoveMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi.fn().mockResolvedValue({
      'test-server': {
        command: 'echo "hello"',
      },
    });

    await parser.parseAsync('remove test-server');

    expect(mockRemoveMcpServer).toHaveBeenCalledWith('test-server');
  });

  it('should show a message if server not found', async () => {
    const mockRemoveMcpServer = vi.fn();
    MockedSettingsManager.prototype.removeMcpServer = mockRemoveMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi
      .fn()
      .mockResolvedValue({});
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await parser.parseAsync('remove non-existent-server');

    expect(mockRemoveMcpServer).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Server "non-existent-server" not found in project settings.',
    );
  });
});
