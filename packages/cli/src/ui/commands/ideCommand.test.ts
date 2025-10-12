/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MockInstance } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ideCommand } from './ideCommand.js';
import { type CommandContext } from './types.js';
import { IDE_DEFINITIONS } from '@google/gemini-cli-core';
import * as core from '@google/gemini-cli-core';
import { SettingScope } from '../../config/settings.js';

vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  return {
    ...actual,
    getOauthClient: vi.fn(),
    getIdeInstaller: vi.fn(),
    IdeClient: {
      getInstance: vi.fn(),
    },
  };
});

describe('ideCommand', () => {
  let mockContext: CommandContext;
  let mockIdeClient: core.IdeClient;
  let platformSpy: MockInstance;

  beforeEach(() => {
    vi.resetAllMocks();

    mockIdeClient = {
      reconnect: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
      getCurrentIde: vi.fn(),
      getConnectionStatus: vi.fn(),
      getDetectedIdeDisplayName: vi.fn(),
    } as unknown as core.IdeClient;

    vi.mocked(core.IdeClient.getInstance).mockResolvedValue(mockIdeClient);
    vi.mocked(mockIdeClient.getDetectedIdeDisplayName).mockReturnValue(
      'VS Code',
    );

    mockContext = {
      ui: {
        addItem: vi.fn(),
      },
      services: {
        settings: {
          setValue: vi.fn(),
        },
        config: {
          getIdeMode: vi.fn(),
          setIdeMode: vi.fn(),
          getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
        },
      },
    } as unknown as CommandContext;

    platformSpy = vi.spyOn(process, 'platform', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct structure', () => {
    expect(ideCommand).not.toBeNull();
    expect(ideCommand.name).toBe('ide');
    expect(ideCommand.subCommands).toHaveLength(4);
    const subCommandNames = ideCommand.subCommands?.map((cmd) => cmd.name);
    expect(subCommandNames).toContain('status');
    expect(subCommandNames).toContain('enable');
    expect(subCommandNames).toContain('disable');
    expect(subCommandNames).toContain('install');
  });

  describe('status subcommand', () => {
    const statusAction = ideCommand.subCommands!.find(
      (c) => c.name === 'status',
    )!.action!;

    it('should show error if no IDE is detected', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(null);

      const result = await statusAction(mockContext, '');

      expect(core.IdeClient.getInstance).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining(
          'IDE integration is not supported in your current environment',
        ),
      });
    });

    it('should show connected status', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(
        IDE_DEFINITIONS.vscode,
      );
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });

      const result = await statusAction(mockContext, '');

      expect(core.IdeClient.getInstance).toHaveBeenCalled();
      expect(vi.mocked(mockIdeClient.getConnectionStatus)).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: '🟢 Connected to VS Code',
      });
    });
  });

  describe('install subcommand', () => {
    const installAction = ideCommand.subCommands!.find(
      (c) => c.name === 'install',
    )!.action!;
    const mockInstall = vi.fn();

    beforeEach(() => {
      vi.mocked(core.getIdeInstaller).mockReturnValue({
        install: mockInstall,
      });
      platformSpy.mockReturnValue('linux');
    });

    it('should show error if no IDE is detected', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(null);

      await installAction(mockContext, '');

      expect(core.IdeClient.getInstance).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: expect.stringContaining(
            'IDE integration is not supported in your current environment',
          ),
        }),
        expect.any(Number),
      );
    });

    it('should show info if already connected', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(
        IDE_DEFINITIONS.vscode,
      );
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });

      await installAction(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'IDE integration is already installed and connected.',
        }),
        expect.any(Number),
      );
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('should install the extension', async () => {
      vi.useFakeTimers();
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(
        IDE_DEFINITIONS.vscode,
      );
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
      });
      mockInstall.mockResolvedValue({
        success: true,
        message: 'Successfully installed.',
      });

      // For the polling loop inside the action.
      vi.mocked(mockIdeClient.getConnectionStatus)
        .mockReturnValueOnce({ status: core.IDEConnectionStatus.Disconnected })
        .mockReturnValue({ status: core.IDEConnectionStatus.Connected });

      const actionPromise = installAction(mockContext, '');
      await vi.runAllTimersAsync();
      await actionPromise;

      expect(core.getIdeInstaller).toHaveBeenCalledWith(IDE_DEFINITIONS.vscode);
      expect(mockInstall).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: `Installing IDE companion...`,
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Successfully installed.',
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: '🟢 Connected to VS Code',
        }),
        expect.any(Number),
      );
      vi.useRealTimers();
    });
  });

  describe('enable subcommand', () => {
    const enableAction = ideCommand.subCommands!.find(
      (c) => c.name === 'enable',
    )!.action!;

    it('should show error if no IDE is detected', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(null);

      await enableAction(mockContext, '');

      expect(core.IdeClient.getInstance).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: expect.stringContaining(
            'IDE integration is not supported in your current environment',
          ),
        }),
        expect.any(Number),
      );
    });

    it('should enable IDE integration', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(
        IDE_DEFINITIONS.vscode,
      );
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });

      await enableAction(mockContext, '');

      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'ide.enabled',
        true,
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: '🟢 Connected to VS Code',
        }),
        expect.any(Number),
      );
    });
  });

  describe('disable subcommand', () => {
    const disableAction = ideCommand.subCommands!.find(
      (c) => c.name === 'disable',
    )!.action!;

    it('should show error if no IDE is detected', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(null);

      await disableAction(mockContext, '');

      expect(core.IdeClient.getInstance).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: expect.stringContaining(
            'IDE integration is not supported in your current environment',
          ),
        }),
        expect.any(Number),
      );
    });

    it('should disable IDE integration', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(
        IDE_DEFINITIONS.vscode,
      );
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
      });

      await disableAction(mockContext, '');

      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'ide.enabled',
        false,
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: '🔴 Disconnected',
        }),
        expect.any(Number),
      );
    });
  });
});
