/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VSCodeIntegration } from './vscodeIntegration.js';
import { VSCodeMCPTransport } from './mcpTransport.js';
import { IDEIntegrationConfig } from '../types.js';

// Mock the MCP transport
vi.mock('./mcpTransport.js');

describe('VSCodeIntegration', () => {
  let integration: VSCodeIntegration;
  let mockConfig: IDEIntegrationConfig;
  let mockTransport: ReturnType<typeof vi.mocked<VSCodeMCPTransport>>;

  beforeEach(() => {
    mockConfig = {
      environment: {
        TERM_PROGRAM: 'vscode',
        GEMINI_CLI_IDE_SERVER_PORT: '58767',
      },
      timeout: 5000,
      debug: false,
    };

    integration = new VSCodeIntegration(mockConfig);
    mockTransport = integration['transport'] as ReturnType<
      typeof vi.mocked<VSCodeMCPTransport>
    >;
  });

  describe('constructor', () => {
    it('should create MCP transport with config', () => {
      expect(VSCodeMCPTransport).toHaveBeenCalledWith(mockConfig);
    });

    it('should initialize with proper config', () => {
      expect(integration).toBeInstanceOf(VSCodeIntegration);
      expect(mockTransport).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when running in VS Code environment with transport available', async () => {
      mockTransport.isAvailable.mockResolvedValue(true);

      const available = await integration.isAvailable();

      expect(available).toBe(true);
      expect(mockTransport.isAvailable).toHaveBeenCalled();
    });

    it('should return false when not running in VS Code environment', async () => {
      const configWithoutVSCode = {
        ...mockConfig,
        environment: { TERM_PROGRAM: 'other' },
      };
      const integrationWithoutVSCode = new VSCodeIntegration(
        configWithoutVSCode,
      );

      const available = await integrationWithoutVSCode.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when transport is not available', async () => {
      mockTransport.isAvailable.mockResolvedValue(false);

      const available = await integration.isAvailable();

      expect(available).toBe(false);
    });

    it('should log debug message when not in VS Code environment', async () => {
      const debugConfig = {
        ...mockConfig,
        debug: true,
        environment: { TERM_PROGRAM: 'other' },
      };
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      const integrationWithDebug = new VSCodeIntegration(debugConfig);
      await integrationWithDebug.isAvailable();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Not running in VS Code environment (TERM_PROGRAM !== "vscode")',
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getActiveFileContext', () => {
    it('should return active file context from transport', async () => {
      const mockActiveFile = {
        filePath: '/test/file.ts',
        cursor: { line: 10, character: 5 },
      };
      mockTransport.getActiveFile.mockResolvedValue(mockActiveFile);

      const context = await integration.getActiveFileContext();

      expect(context).toEqual({
        filePath: '/test/file.ts',
        cursor: { line: 10, character: 5 },
      });
    });

    it('should return null when transport returns null', async () => {
      mockTransport.getActiveFile.mockResolvedValue(null);

      const context = await integration.getActiveFileContext();

      expect(context).toBeNull();
    });

    it('should return null when transport returns file without path', async () => {
      const mockActiveFile = {
        filePath: '',
        cursor: { line: 10, character: 5 },
      };
      mockTransport.getActiveFile.mockResolvedValue(mockActiveFile);

      const context = await integration.getActiveFileContext();

      expect(context).toBeNull();
    });

    it('should handle transport errors gracefully', async () => {
      mockTransport.getActiveFile.mockRejectedValue(
        new Error('Transport error'),
      );

      const context = await integration.getActiveFileContext();

      expect(context).toBeNull();
    });

    it('should log debug message when transport fails', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const integrationWithDebug = new VSCodeIntegration(debugConfig);
      const debugTransport = integrationWithDebug['transport'] as ReturnType<
        typeof vi.mocked<VSCodeMCPTransport>
      >;

      debugTransport.getActiveFile.mockRejectedValue(
        new Error('Transport error'),
      );

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await integrationWithDebug.getActiveFileContext();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error getting active file context from VS Code:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should handle active file without cursor', async () => {
      const mockActiveFile = {
        filePath: '/test/file.ts',
      };
      mockTransport.getActiveFile.mockResolvedValue(mockActiveFile);

      const context = await integration.getActiveFileContext();

      expect(context).toEqual({
        filePath: '/test/file.ts',
        cursor: undefined,
      });
    });
  });

  describe('sendNotification', () => {
    it('should delegate to transport', async () => {
      mockTransport.sendNotification.mockResolvedValue();

      await integration.sendNotification('Test message');

      expect(mockTransport.sendNotification).toHaveBeenCalledWith(
        'Test message',
      );
    });

    it('should not throw even if transport fails', async () => {
      mockTransport.sendNotification.mockRejectedValue(
        new Error('Transport error'),
      );

      await expect(
        integration.sendNotification('Test message'),
      ).resolves.not.toThrow();
    });
  });

  describe('initialize', () => {
    it('should initialize transport successfully', async () => {
      mockTransport.initialize.mockResolvedValue();

      await integration.initialize();

      expect(mockTransport.initialize).toHaveBeenCalled();
    });

    it('should log debug messages when debug is enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const integrationWithDebug = new VSCodeIntegration(debugConfig);
      const debugTransport = integrationWithDebug['transport'] as ReturnType<
        typeof vi.mocked<VSCodeMCPTransport>
      >;

      debugTransport.initialize.mockResolvedValue();

      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      await integrationWithDebug.initialize();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Initializing VS Code integration...',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'VS Code integration initialized successfully',
      );

      consoleSpy.mockRestore();
    });

    it('should handle and rethrow initialization errors', async () => {
      const error = new Error('Initialization failed');
      mockTransport.initialize.mockRejectedValue(error);

      await expect(integration.initialize()).rejects.toThrow(
        'Initialization failed',
      );
    });

    it('should log error when initialization fails with debug enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const integrationWithDebug = new VSCodeIntegration(debugConfig);
      const debugTransport = integrationWithDebug['transport'] as ReturnType<
        typeof vi.mocked<VSCodeMCPTransport>
      >;

      const error = new Error('Initialization failed');
      debugTransport.initialize.mockRejectedValue(error);

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await expect(integrationWithDebug.initialize()).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to initialize VS Code integration:',
        error,
      );

      consoleSpy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('should cleanup transport successfully', async () => {
      mockTransport.cleanup.mockResolvedValue();

      await integration.cleanup();

      expect(mockTransport.cleanup).toHaveBeenCalled();
    });

    it('should log debug messages when debug is enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const integrationWithDebug = new VSCodeIntegration(debugConfig);
      const debugTransport = integrationWithDebug['transport'] as ReturnType<
        typeof vi.mocked<VSCodeMCPTransport>
      >;

      debugTransport.cleanup.mockResolvedValue();

      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      await integrationWithDebug.cleanup();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Cleaning up VS Code integration...',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'VS Code integration cleaned up successfully',
      );

      consoleSpy.mockRestore();
    });

    it('should handle cleanup errors gracefully', async () => {
      const error = new Error('Cleanup failed');
      mockTransport.cleanup.mockRejectedValue(error);

      await expect(integration.cleanup()).resolves.not.toThrow();
    });

    it('should log warning when cleanup fails with debug enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const integrationWithDebug = new VSCodeIntegration(debugConfig);
      const debugTransport = integrationWithDebug['transport'] as ReturnType<
        typeof vi.mocked<VSCodeMCPTransport>
      >;

      const error = new Error('Cleanup failed');
      debugTransport.cleanup.mockRejectedValue(error);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await integrationWithDebug.cleanup();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error during VS Code integration cleanup:',
        error,
      );

      consoleSpy.mockRestore();
    });
  });

  describe('setActiveFileChangeHandler', () => {
    it('should set up notification handler on transport', () => {
      const mockHandler = vi.fn();
      mockTransport.setNotificationHandler.mockImplementation(() => {});

      integration.setActiveFileChangeHandler(mockHandler);

      expect(mockTransport.setNotificationHandler).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it('should call handler with converted context when transport notifies', () => {
      const mockHandler = vi.fn();
      let transportHandler:
        | ((params: {
            filePath: string;
            cursor?: { line: number; character: number };
          }) => void)
        | undefined;

      mockTransport.setNotificationHandler.mockImplementation((handler) => {
        transportHandler = handler;
      });

      integration.setActiveFileChangeHandler(mockHandler);

      // Simulate transport notification
      const transportParams = {
        filePath: '/test/file.ts',
        cursor: { line: 5, character: 10 },
      };

      transportHandler!(transportParams);

      expect(mockHandler).toHaveBeenCalledWith({
        filePath: '/test/file.ts',
        cursor: { line: 5, character: 10 },
      });
    });

    it('should call handler with null when transport sends empty params', () => {
      const mockHandler = vi.fn();
      let transportHandler:
        | ((params: {
            filePath: string;
            cursor?: { line: number; character: number };
          }) => void)
        | undefined;

      mockTransport.setNotificationHandler.mockImplementation((handler) => {
        transportHandler = handler;
      });

      integration.setActiveFileChangeHandler(mockHandler);

      // Simulate transport notification with empty params
      transportHandler!({ filePath: '' });

      expect(mockHandler).toHaveBeenCalledWith(null);
    });
  });

  describe('getMCPClient', () => {
    it('should delegate to transport', () => {
      const mockClient = null;
      mockTransport.getMCPClient.mockReturnValue(mockClient);

      const client = integration.getMCPClient();

      expect(client).toBe(mockClient);
      expect(mockTransport.getMCPClient).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle undefined environment variables', async () => {
      const configWithUndefinedEnv = {
        ...mockConfig,
        environment: {
          TERM_PROGRAM: undefined,
          GEMINI_CLI_IDE_SERVER_PORT: undefined,
        },
      };
      const integrationWithUndefinedEnv = new VSCodeIntegration(
        configWithUndefinedEnv,
      );

      const available = await integrationWithUndefinedEnv.isAvailable();

      expect(available).toBe(false);
    });

    it('should handle empty string environment variables', async () => {
      const configWithEmptyEnv = {
        ...mockConfig,
        environment: {
          TERM_PROGRAM: '',
          GEMINI_CLI_IDE_SERVER_PORT: '',
        },
      };
      const integrationWithEmptyEnv = new VSCodeIntegration(configWithEmptyEnv);

      const available = await integrationWithEmptyEnv.isAvailable();

      expect(available).toBe(false);
    });

    it('should handle missing cursor in active file response', async () => {
      const mockActiveFile = {
        filePath: '/test/file.ts',
        cursor: undefined,
      };
      mockTransport.getActiveFile.mockResolvedValue(mockActiveFile);

      const context = await integration.getActiveFileContext();

      expect(context).toEqual({
        filePath: '/test/file.ts',
        cursor: undefined,
      });
    });
  });
});
