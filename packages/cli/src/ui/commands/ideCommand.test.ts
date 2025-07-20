/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ideCommand } from './ideCommand.js';
import { type CommandContext } from './types.js';
import {
  type Config,
  ideIntegrationManager,
  ideIntegrationRegistry,
} from '@google/gemini-cli-core';
import * as child_process from 'child_process';
import { glob } from 'glob';

vi.mock('child_process');
vi.mock('glob');
vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...original,
    ideIntegrationManager: {
      initialize: vi.fn(),
      getStatus: vi.fn(),
    },
    ideIntegrationRegistry: {
      getRegisteredIds: vi.fn(),
    },
  };
});

describe('ideCommand', () => {
  let mockContext: CommandContext;
  let mockConfig: Config;
  let execSyncSpy: vi.SpyInstance;
  let globSyncSpy: vi.SpyInstance;
  let platformSpy: vi.SpyInstance;

  beforeEach(() => {
    mockContext = {
      ui: {
        addItem: vi.fn(),
      },
    } as unknown as CommandContext;

    mockConfig = {
      getIdeMode: vi.fn(),
      getDebugMode: vi.fn().mockReturnValue(false),
    } as unknown as Config;

    execSyncSpy = vi.spyOn(child_process, 'execSync');
    globSyncSpy = vi.spyOn(glob, 'sync');
    platformSpy = vi.spyOn(process, 'platform', 'get');

    // Reset mocks
    vi.mocked(ideIntegrationManager.initialize).mockResolvedValue(undefined);
    vi.mocked(ideIntegrationManager.getStatus).mockResolvedValue({
      active: false,
    });
    vi.mocked(ideIntegrationRegistry.getRegisteredIds).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null if ideMode is not enabled', () => {
    (mockConfig.getIdeMode as vi.Mock).mockReturnValue(false);
    const command = ideCommand(mockConfig);
    expect(command).toBeNull();
  });

  it('should return the ide command if ideMode is enabled', () => {
    (mockConfig.getIdeMode as vi.Mock).mockReturnValue(true);
    const command = ideCommand(mockConfig);
    expect(command).not.toBeNull();
    expect(command?.name).toBe('ide');
    expect(command?.subCommands).toHaveLength(2);
    expect(command?.subCommands?.[0].name).toBe('status');
    expect(command?.subCommands?.[1].name).toBe('install');
  });

  describe('status subcommand', () => {
    beforeEach(() => {
      (mockConfig.getIdeMode as vi.Mock).mockReturnValue(true);
    });

    it('should show connected status', async () => {
      vi.mocked(ideIntegrationManager.getStatus).mockResolvedValue({
        active: true,
        integration: {
          id: 'vscode',
          name: 'Visual Studio Code',
          description: 'VS Code integration via MCP',
          available: true,
        },
      });
      vi.mocked(ideIntegrationRegistry.getRegisteredIds).mockReturnValue([
        'vscode',
      ]);

      const command = ideCommand(mockConfig);
      const result = await command?.subCommands?.[0].action(mockContext, '');

      expect(vi.mocked(ideIntegrationManager.initialize)).toHaveBeenCalledWith({
        environment: process.env,
        timeout: 5000,
        debug: false,
      });
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('🟢 Visual Studio Code - Connected'),
      });
    });

    it('should show disconnected status', async () => {
      vi.mocked(ideIntegrationManager.getStatus).mockResolvedValue({
        active: true,
        integration: {
          id: 'vscode',
          name: 'Visual Studio Code',
          description: 'VS Code integration via MCP',
          available: false,
        },
      });
      vi.mocked(ideIntegrationRegistry.getRegisteredIds).mockReturnValue([
        'vscode',
      ]);

      const command = ideCommand(mockConfig);
      const result = await command?.subCommands?.[0].action(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining(
          '🔴 Visual Studio Code - Disconnected',
        ),
      });
    });

    it('should show no active integration status', async () => {
      vi.mocked(ideIntegrationManager.getStatus).mockResolvedValue({
        active: false,
      });
      vi.mocked(ideIntegrationRegistry.getRegisteredIds).mockReturnValue([
        'vscode',
      ]);

      const command = ideCommand(mockConfig);
      const result = await command?.subCommands?.[0].action(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('🔴 No IDE integration active'),
      });
    });

    it('should show no registered integrations', async () => {
      vi.mocked(ideIntegrationManager.getStatus).mockResolvedValue({
        active: false,
      });
      vi.mocked(ideIntegrationRegistry.getRegisteredIds).mockReturnValue([]);

      const command = ideCommand(mockConfig);
      const result = await command?.subCommands?.[0].action(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('⚠️  No IDE integrations registered'),
      });
    });
  });

  describe('install subcommand', () => {
    beforeEach(() => {
      (mockConfig.getIdeMode as vi.Mock).mockReturnValue(true);
      platformSpy.mockReturnValue('linux');
    });

    it('should show an error if no supported IDEs are found', async () => {
      execSyncSpy.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const command = ideCommand(mockConfig);
      await command?.subCommands?.[1].action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: 'No supported IDEs found on your system. Currently supported: VS Code',
        }),
        expect.any(Number),
      );
    });

    it('should show an error if the VSIX file is not found', async () => {
      execSyncSpy.mockReturnValue(''); // VSCode is installed
      globSyncSpy.mockReturnValue([]); // No .vsix file found

      const command = ideCommand(mockConfig);
      await command?.subCommands?.[1].action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Found Visual Studio Code. Installing companion extension...',
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: expect.stringContaining(
            'Could not find the required VS Code companion extension',
          ),
        }),
        expect.any(Number),
      );
    });

    it('should install the extension if found in the bundle directory', async () => {
      const vsixPath = '/path/to/bundle/gemini.vsix';
      execSyncSpy.mockReturnValue(''); // VSCode is installed
      globSyncSpy.mockReturnValue([vsixPath]); // Found .vsix file

      const command = ideCommand(mockConfig);
      await command?.subCommands?.[1].action(mockContext, '');

      expect(globSyncSpy).toHaveBeenCalledWith(
        expect.stringContaining('.vsix'),
      );
      expect(execSyncSpy).toHaveBeenCalledWith(
        `code --install-extension ${vsixPath} --force`,
        { stdio: 'pipe' },
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Found Visual Studio Code. Installing companion extension...',
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Visual Studio Code companion extension installed successfully. Restart gemini-cli in a fresh terminal window.',
        }),
        expect.any(Number),
      );
    });

    it('should install the extension if found in the dev directory', async () => {
      const vsixPath = '/path/to/dev/gemini.vsix';
      execSyncSpy.mockReturnValue(''); // VSCode is installed
      // First glob call for bundle returns nothing, second for dev returns path.
      globSyncSpy.mockReturnValueOnce([]).mockReturnValueOnce([vsixPath]);

      const command = ideCommand(mockConfig);
      await command?.subCommands?.[1].action(mockContext, '');

      expect(globSyncSpy).toHaveBeenCalledTimes(2);
      expect(execSyncSpy).toHaveBeenCalledWith(
        `code --install-extension ${vsixPath} --force`,
        { stdio: 'pipe' },
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Visual Studio Code companion extension installed successfully. Restart gemini-cli in a fresh terminal window.',
        }),
        expect.any(Number),
      );
    });

    it('should show an error if installation fails', async () => {
      const vsixPath = '/path/to/bundle/gemini.vsix';
      execSyncSpy
        .mockReturnValueOnce('') // VSCode is installed check
        .mockImplementation(() => {
          // Installation command
          const error: Error & { stderr?: Buffer } = new Error(
            'Command failed',
          );
          error.stderr = Buffer.from('Installation failed');
          throw error;
        });
      globSyncSpy.mockReturnValue([vsixPath]);

      const command = ideCommand(mockConfig);
      await command?.subCommands?.[1].action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: expect.stringContaining(
            'Failed to install Visual Studio Code companion extension',
          ),
        }),
        expect.any(Number),
      );
    });
  });
});
