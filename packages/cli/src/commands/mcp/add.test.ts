/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import yargs from 'yargs';
import { addCommand } from './add.js';
import { SettingsManager } from '../../config/settings-manager.js';

vi.mock('../../config/settings-manager.js');

const MockedSettingsManager = SettingsManager as vi.Mocked<
  typeof SettingsManager
>;

describe('mcp add command', () => {
  let parser: yargs.Argv;

  beforeEach(() => {
    vi.resetAllMocks();
    const yargsInstance = yargs([]).command(addCommand);
    parser = yargsInstance;
  });

  it('should add a stdio server to project settings', async () => {
    const mockAddMcpServer = vi.fn();
    MockedSettingsManager.prototype.addMcpServer = mockAddMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi
      .fn()
      .mockResolvedValue({});

    await parser.parseAsync(
      'add my-server /path/to/server arg1 arg2 -e FOO=bar',
    );

    expect(mockAddMcpServer).toHaveBeenCalledWith('my-server', {
      command: '/path/to/server',
      args: ['arg1', 'arg2'],
      env: { FOO: 'bar' },
    });
  });

  it('should add an sse server to user settings', async () => {
    const mockAddMcpServer = vi.fn();
    MockedSettingsManager.prototype.addMcpServer = mockAddMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi
      .fn()
      .mockResolvedValue({});

    await parser.parseAsync(
      'add --transport sse sse-server https://example.com/sse-endpoint --scope user -H "X-API-Key: your-key"',
    );

    expect(mockAddMcpServer).toHaveBeenCalledWith('sse-server', {
      url: 'https://example.com/sse-endpoint',
      headers: { 'X-API-Key': 'your-key' },
    });
  });

  it('should add an http server to project settings', async () => {
    const mockAddMcpServer = vi.fn();
    MockedSettingsManager.prototype.addMcpServer = mockAddMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi
      .fn()
      .mockResolvedValue({});

    await parser.parseAsync(
      'add --transport http http-server https://example.com/mcp -H "Authorization: Bearer your-token"',
    );

    expect(mockAddMcpServer).toHaveBeenCalledWith('http-server', {
      httpUrl: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer your-token' },
    });
  });

  it('should handle MCP server args with -- separator', async () => {
    const mockAddMcpServer = vi.fn();
    MockedSettingsManager.prototype.addMcpServer = mockAddMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi
      .fn()
      .mockResolvedValue({});

    await parser.parseAsync(
      'add my-server npx -- -y http://example.com/some-package',
    );

    expect(mockAddMcpServer).toHaveBeenCalledWith('my-server', {
      command: 'npx',
      args: ['-y', 'http://example.com/some-package'],
    });
  });

  it('should handle unknown options as MCP server args', async () => {
    const mockAddMcpServer = vi.fn();
    MockedSettingsManager.prototype.addMcpServer = mockAddMcpServer;
    MockedSettingsManager.prototype.getMcpServers = vi
      .fn()
      .mockResolvedValue({});

    await parser.parseAsync(
      'add test-server npx -y http://example.com/some-package',
    );

    expect(mockAddMcpServer).toHaveBeenCalledWith('test-server', {
      command: 'npx',
      args: ['-y', 'http://example.com/some-package'],
    });
  });
});
