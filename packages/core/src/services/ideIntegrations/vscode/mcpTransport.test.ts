/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VSCodeMCPTransport } from './mcpTransport.js';
import { IDEIntegrationConfig } from '../types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js');

// Mock fetch for HTTP availability checks
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VSCodeMCPTransport', () => {
  let transport: VSCodeMCPTransport;
  let mockConfig: IDEIntegrationConfig;
  let mockClient: ReturnType<typeof vi.mocked<Client>>;
  let mockTransportInstance: ReturnType<
    typeof vi.mocked<StreamableHTTPClientTransport>
  >;

  beforeEach(() => {
    mockConfig = {
      environment: {
        GEMINI_CLI_IDE_SERVER_PORT: '58767',
      },
      timeout: 5000,
      debug: false,
    };

    mockClient = {
      connect: vi.fn(),
      callTool: vi.fn(),
      setNotificationHandler: vi.fn(),
      close: vi.fn(),
      onerror: undefined,
    } as ReturnType<typeof vi.mocked<Client>>;

    mockTransportInstance = {
      // Add any methods needed by the transport
    } as ReturnType<typeof vi.mocked<StreamableHTTPClientTransport>>;

    vi.mocked(Client).mockImplementation(() => mockClient);
    vi.mocked(StreamableHTTPClientTransport).mockImplementation(
      () => mockTransportInstance,
    );

    transport = new VSCodeMCPTransport(mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should discover port from environment variable', () => {
      expect(transport['port']).toBe(58767);
    });

    it('should handle invalid port in environment variable', () => {
      const configWithInvalidPort = {
        ...mockConfig,
        environment: { GEMINI_CLI_IDE_SERVER_PORT: 'invalid' },
      };
      const transportWithInvalidPort = new VSCodeMCPTransport(
        configWithInvalidPort,
      );

      expect(transportWithInvalidPort['port']).toBeNull();
    });

    it('should handle missing port environment variable', () => {
      const configWithoutPort = {
        ...mockConfig,
        environment: {},
      };
      const transportWithoutPort = new VSCodeMCPTransport(configWithoutPort);

      expect(transportWithoutPort['port']).toBeNull();
    });

    it('should handle port out of range', () => {
      const configWithOutOfRangePort = {
        ...mockConfig,
        environment: { GEMINI_CLI_IDE_SERVER_PORT: '70000' },
      };
      const transportWithOutOfRange = new VSCodeMCPTransport(
        configWithOutOfRangePort,
      );

      expect(transportWithOutOfRange['port']).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return false when no port is configured', async () => {
      const configWithoutPort = {
        ...mockConfig,
        environment: {},
      };
      const transportWithoutPort = new VSCodeMCPTransport(configWithoutPort);

      const available = await transportWithoutPort.isAvailable();

      expect(available).toBe(false);
    });

    it('should return true when server responds with 400 status', async () => {
      mockFetch.mockResolvedValue({
        status: 400,
      });

      const available = await transport.isAvailable();

      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:58767/mcp', {
        method: 'GET',
        signal: expect.any(AbortSignal),
      });
    });

    it('should return false when server responds with other status', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
      });

      const available = await transport.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when fetch throws an error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection failed'));

      const available = await transport.isAvailable();

      expect(available).toBe(false);
    });

    it('should log debug message when server is not available and debug is enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);

      mockFetch.mockRejectedValue(new Error('Connection failed'));
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      await transportWithDebug.isAvailable();

      expect(consoleSpy).toHaveBeenCalledWith(
        'VS Code MCP server not available on port 58767:',
        'Connection failed',
      );

      consoleSpy.mockRestore();
    });

    it.skip('should handle fetch timeout', async () => {
      // Mock fetch to never resolve (simulating timeout)
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const available = await transport.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should throw error when no port is configured', async () => {
      const configWithoutPort = {
        ...mockConfig,
        environment: {},
      };
      const transportWithoutPort = new VSCodeMCPTransport(configWithoutPort);

      await expect(transportWithoutPort.initialize()).rejects.toThrow(
        'VS Code integration not available: GEMINI_CLI_IDE_SERVER_PORT environment variable not set',
      );
    });

    it('should return early if client is already initialized', async () => {
      transport['mcpClient'] = mockClient;

      await transport.initialize();

      expect(Client).not.toHaveBeenCalled();
    });

    it('should create and connect MCP client', async () => {
      mockClient.connect.mockResolvedValue();

      await transport.initialize();

      expect(Client).toHaveBeenCalledWith({
        name: 'gemini-cli-vscode-integration',
        version: '1.0.0',
      });

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://localhost:58767/mcp'),
      );

      expect(mockClient.connect).toHaveBeenCalledWith(mockTransportInstance, {
        timeout: 5000,
      });
    });

    it('should use default timeout when not specified in config', async () => {
      const configWithoutTimeout = {
        ...mockConfig,
        timeout: undefined,
      };
      const transportWithoutTimeout = new VSCodeMCPTransport(
        configWithoutTimeout,
      );

      mockClient.connect.mockResolvedValue();

      await transportWithoutTimeout.initialize();

      expect(mockClient.connect).toHaveBeenCalledWith(mockTransportInstance, {
        timeout: 10000,
      });
    });

    it('should set up error handler', async () => {
      mockClient.connect.mockResolvedValue();

      await transport.initialize();

      expect(mockClient.onerror).toBeDefined();
    });

    it('should log debug message when debug is enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);

      mockClient.connect.mockResolvedValue();
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      await transportWithDebug.initialize();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Connected to VS Code MCP server on port 58767',
      );

      consoleSpy.mockRestore();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      mockClient.connect.mockRejectedValue(error);

      await expect(transport.initialize()).rejects.toThrow(
        'Failed to connect to VS Code MCP server: Connection failed',
      );
    });

    it('should call error handler when set up', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);

      mockClient.connect.mockResolvedValue();
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await transportWithDebug.initialize();

      // Simulate an error
      const errorHandler = mockClient.onerror;
      expect(errorHandler).toBeDefined();

      if (errorHandler) {
        errorHandler(new Error('Test error'));

        expect(consoleSpy).toHaveBeenCalledWith(
          'VS Code MCP client error:',
          'Error: Test error',
        );
      }

      consoleSpy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('should do nothing when no client exists', async () => {
      await transport.cleanup();

      expect(mockClient.close).not.toHaveBeenCalled();
    });

    it('should close client when it exists', async () => {
      transport['mcpClient'] = mockClient;

      await transport.cleanup();

      expect(mockClient.close).toHaveBeenCalled();
      expect(transport['mcpClient']).toBeNull();
    });

    it('should handle close errors gracefully', async () => {
      transport['mcpClient'] = mockClient;
      mockClient.close.mockImplementation(() => {
        throw new Error('Close failed');
      });

      await expect(transport.cleanup()).resolves.not.toThrow();
      expect(transport['mcpClient']).toBeNull();
    });

    it('should log debug message when debug is enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);
      transportWithDebug['mcpClient'] = mockClient;

      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      await transportWithDebug.cleanup();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Closed VS Code MCP client connection',
      );

      consoleSpy.mockRestore();
    });

    it('should log warning when close fails with debug enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);
      transportWithDebug['mcpClient'] = mockClient;

      const error = new Error('Close failed');
      mockClient.close.mockImplementation(() => {
        throw error;
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await transportWithDebug.cleanup();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error closing VS Code MCP client:',
        'Close failed',
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getActiveFile', () => {
    beforeEach(() => {
      transport['mcpClient'] = mockClient;
    });

    it('should throw error when client is not initialized', async () => {
      transport['mcpClient'] = null;

      await expect(transport.getActiveFile()).rejects.toThrow(
        'VS Code MCP client not initialized',
      );
    });

    it('should call tool and parse response successfully', async () => {
      const mockResult = {
        content: [
          {
            type: 'text',
            text: 'Active file: /test/file.ts',
          },
        ],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(mockClient.callTool).toHaveBeenCalledWith(
        {
          name: 'getActiveFile',
          arguments: {},
        },
        undefined,
        { timeout: 5000 },
      );

      expect(result).toEqual({
        filePath: '/test/file.ts',
      });
    });

    it('should return null when no file is active', async () => {
      const mockResult = {
        content: [
          {
            type: 'text',
            text: 'No file is currently active',
          },
        ],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(result).toBeNull();
    });

    it('should return null when content is not an array', async () => {
      const mockResult = {
        content: 'not an array',
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(result).toBeNull();
    });

    it('should return null when content is empty array', async () => {
      const mockResult = {
        content: [],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(result).toBeNull();
    });

    it('should return null when content type is not text', async () => {
      const mockResult = {
        content: [
          {
            type: 'image',
            data: 'base64data',
          },
        ],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(result).toBeNull();
    });

    it('should return null when file path pattern does not match', async () => {
      const mockResult = {
        content: [
          {
            type: 'text',
            text: 'Some other message',
          },
        ],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(result).toBeNull();
    });

    it('should handle callTool errors gracefully', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool call failed'));

      const result = await transport.getActiveFile();

      expect(result).toBeNull();
    });

    it('should log debug message when tool call fails with debug enabled', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);
      transportWithDebug['mcpClient'] = mockClient;

      const error = new Error('Tool call failed');
      mockClient.callTool.mockRejectedValue(error);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await transportWithDebug.getActiveFile();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error getting active file from VS Code:',
        'Tool call failed',
      );

      consoleSpy.mockRestore();
    });

    it('should use custom timeout from config', async () => {
      const configWithCustomTimeout = {
        ...mockConfig,
        timeout: 15000,
      };
      const transportWithCustomTimeout = new VSCodeMCPTransport(
        configWithCustomTimeout,
      );
      transportWithCustomTimeout['mcpClient'] = mockClient;

      const mockResult = {
        content: [{ type: 'text', text: 'Active file: /test/file.ts' }],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      await transportWithCustomTimeout.getActiveFile();

      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
        { timeout: 15000 },
      );
    });
  });

  describe('setNotificationHandler', () => {
    beforeEach(() => {
      transport['mcpClient'] = mockClient;
    });

    it('should throw error when client is not initialized', () => {
      transport['mcpClient'] = null;

      expect(() => {
        transport.setNotificationHandler(() => {});
      }).toThrow('VS Code MCP client not initialized');
    });

    it('should set up notification handler on client', () => {
      const mockHandler = vi.fn();

      transport.setNotificationHandler(mockHandler);

      expect(mockClient.setNotificationHandler).toHaveBeenCalledWith(
        expect.anything(), // ActiveFileNotificationSchema
        expect.any(Function),
      );
    });

    it('should call handler with notification params', () => {
      const mockHandler = vi.fn();
      let clientHandler:
        | ((notification: { method: string; params: unknown }) => void)
        | undefined;

      mockClient.setNotificationHandler.mockImplementation(
        (schema, handler) => {
          clientHandler = handler;
        },
      );

      transport.setNotificationHandler(mockHandler);

      // Simulate notification
      const notification = {
        method: 'activeFileNotification',
        params: {
          filePath: '/test/file.ts',
          cursor: { line: 10, character: 5 },
        },
      };

      clientHandler!(notification);

      expect(mockHandler).toHaveBeenCalledWith({
        filePath: '/test/file.ts',
        cursor: { line: 10, character: 5 },
      });
    });
  });

  describe('sendNotification', () => {
    it('should log debug message for unimplemented feature', async () => {
      const debugConfig = { ...mockConfig, debug: true };
      const transportWithDebug = new VSCodeMCPTransport(debugConfig);

      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      await transportWithDebug.sendNotification('Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        'VS Code notification (not implemented): Test message',
      );

      consoleSpy.mockRestore();
    });

    it('should complete without error even with debug disabled', async () => {
      await expect(
        transport.sendNotification('Test message'),
      ).resolves.not.toThrow();
    });
  });

  describe('getMCPClient', () => {
    it('should return null when no client exists', () => {
      const client = transport.getMCPClient();

      expect(client).toBeNull();
    });

    it('should return client when it exists', () => {
      transport['mcpClient'] = mockClient;

      const client = transport.getMCPClient();

      expect(client).toBe(mockClient);
    });
  });

  describe('edge cases', () => {
    it('should handle port 0', () => {
      const configWithPortZero = {
        ...mockConfig,
        environment: { GEMINI_CLI_IDE_SERVER_PORT: '0' },
      };
      const transportWithPortZero = new VSCodeMCPTransport(configWithPortZero);

      expect(transportWithPortZero['port']).toBeNull();
    });

    it('should handle negative port', () => {
      const configWithNegativePort = {
        ...mockConfig,
        environment: { GEMINI_CLI_IDE_SERVER_PORT: '-1' },
      };
      const transportWithNegativePort = new VSCodeMCPTransport(
        configWithNegativePort,
      );

      expect(transportWithNegativePort['port']).toBeNull();
    });

    it('should trim whitespace from file path', async () => {
      transport['mcpClient'] = mockClient;

      const mockResult = {
        content: [
          {
            type: 'text',
            text: 'Active file:   /test/file.ts   ',
          },
        ],
      };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await transport.getActiveFile();

      expect(result).toEqual({
        filePath: '/test/file.ts',
      });
    });
  });
});
