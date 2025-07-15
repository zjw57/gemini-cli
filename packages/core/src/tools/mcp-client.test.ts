/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  populateMcpServerCommand,
  createTransport,
  generateValidName,
  isEnabled,
  discoverTools,
  discoverMcpTools,
} from './mcp-client.js';
import { sanitizeParameters } from './tool-registry.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as GenAiLib from '@google/genai';
import { Schema, Type } from '@google/genai';
import { parse, ParseEntry } from 'shell-quote';
import { MCPServerConfig, Config } from '../config/config.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { Mocked } from 'vitest';

// Mock dependencies
vi.mock('shell-quote', () => ({
  parse: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const MockedClient = vi.fn();
  MockedClient.prototype.connect = vi.fn();
  MockedClient.prototype.listTools = vi.fn();
  // Ensure instances have an onerror property that can be spied on or assigned to
  MockedClient.mockImplementation(() => ({
    connect: MockedClient.prototype.connect,
    listTools: MockedClient.prototype.listTools,
    onerror: vi.fn(), // Each instance gets its own onerror mock
  }));
  return { Client: MockedClient };
});

// Define a global mock for stderr.on that can be cleared and checked
const mockGlobalStdioStderrOn = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  // This is the constructor for StdioClientTransport
  const MockedStdioTransport = vi.fn().mockImplementation(function (
    this: any,
    options: any,
  ) {
    // Always return a new object with a fresh reference to the global mock for .on
    this.options = options;
    this.stderr = { on: mockGlobalStdioStderrOn };
    this.close = vi.fn().mockResolvedValue(undefined); // Add mock close method
    return this;
  });
  return { StdioClientTransport: MockedStdioTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => {
  const MockedSSETransport = vi.fn().mockImplementation(function (this: any) {
    this.close = vi.fn().mockResolvedValue(undefined);
    return this;
  });
  return { SSEClientTransport: MockedSSETransport };
});

vi.mock('@google/genai', () => {
  const mockTool = vi.fn().mockResolvedValue({
    functionDeclarations: [
      {
        name: 'test-tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
      },
    ],
  });
  const mockMcpToTool = vi.fn().mockReturnValue({ tool: mockTool });
  return { 
    mcpToTool: mockMcpToTool,
    Type: {
      STRING: 'string',
      NUMBER: 'number',
      BOOLEAN: 'boolean',
      ARRAY: 'array',
      OBJECT: 'object',
    }
  };
});

// Mock OAuth modules
vi.mock('../mcp/oauth-provider.js', () => ({
  MCPOAuthProvider: {
    authenticate: vi.fn(),
    getValidToken: vi.fn(),
  },
}));

vi.mock('../mcp/oauth-token-storage.js', () => ({
  MCPOAuthTokenStorage: {
    getToken: vi.fn(),
  },
}));

vi.mock('../mcp/oauth-discovery.js', () => ({
  discoverOAuthFromWWWAuthenticate: vi.fn(),
  discoverOAuthConfig: vi.fn(),
}));

// Mock StreamableHTTPClientTransport
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  const MockedStreamableHTTPTransport = vi.fn();
  MockedStreamableHTTPTransport.prototype.close = vi
    .fn()
    .mockResolvedValue(undefined);
  MockedStreamableHTTPTransport.mockImplementation(function (this: any) {
    this.close = vi.fn().mockResolvedValue(undefined);
    return this;
  });
  return { StreamableHTTPClientTransport: MockedStreamableHTTPTransport };
});

const mockToolRegistryInstance = {
  registerTool: vi.fn(),
  getToolsByServer: vi.fn().mockReturnValue([]), // Default to empty array
  // Add other methods if they are called by the code under test, with default mocks
  getTool: vi.fn(),
  getAllTools: vi.fn().mockReturnValue([]),
  getFunctionDeclarations: vi.fn().mockReturnValue([]),
  discoverTools: vi.fn().mockResolvedValue(undefined),
};
vi.mock('./tool-registry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    ToolRegistry: vi.fn(() => mockToolRegistryInstance),
    sanitizeParameters: (actual as Record<string, unknown>).sanitizeParameters,
  };
});

describe('discoverMcpTools', () => {
  let mockConfig: Mocked<Config>;
  // Use the instance from the module mock
  let mockToolRegistry: typeof mockToolRegistryInstance;

  beforeEach(() => {
    // Assign the shared mock instance to the test-scoped variable
    mockToolRegistry = mockToolRegistryInstance;
    // Reset individual spies on the shared instance before each test
    mockToolRegistry.registerTool.mockClear();
    mockToolRegistry.getToolsByServer.mockClear().mockReturnValue([]); // Reset to default
    mockToolRegistry.getTool.mockClear().mockReturnValue(undefined); // Default to no existing tool
    mockToolRegistry.getAllTools.mockClear().mockReturnValue([]);
    mockToolRegistry.getFunctionDeclarations.mockClear().mockReturnValue([]);
    mockToolRegistry.discoverTools.mockClear().mockResolvedValue(undefined);

    mockConfig = {
      getMcpServers: vi.fn().mockReturnValue({}),
      getMcpServerCommand: vi.fn().mockReturnValue(undefined),
      // getToolRegistry should now return the same shared mock instance
      getToolRegistry: vi.fn(() => mockToolRegistry),
      getDebugMode: vi.fn().mockReturnValue(false),
    } as unknown as Mocked<Config>;

    vi.mocked(parse).mockClear();
    vi.mocked(parse).mockReturnValue(['mock', 'command', 'args']);
    vi.mocked(ClientLib.Client).mockClear();
    vi.mocked(ClientLib.Client.prototype.connect)
      .mockClear()
      .mockResolvedValue(undefined);
    vi.mocked(ClientLib.Client.prototype.listTools)
      .mockClear()
      .mockResolvedValue({ tools: [] });

    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockClear();
    // Ensure the StdioClientTransport mock constructor returns an object with a close method
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockImplementation(
      function (
        this: any,
        options: any,
      ) {
        this.options = options;
        this.stderr = { on: mockGlobalStdioStderrOn };
        this.close = vi.fn().mockResolvedValue(undefined);
        return this;
      },
    );
    mockGlobalStdioStderrOn.mockClear(); // Clear the global mock in beforeEach

    vi.clearAllMocks();
  });

  it('should do nothing if no MCP servers or command are configured', async () => {
    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );
    expect(mockConfig.getMcpServers).toHaveBeenCalledTimes(1);
    expect(mockConfig.getMcpServerCommand).toHaveBeenCalledTimes(1);
    expect(ClientLib.Client).not.toHaveBeenCalled();
    expect(mockToolRegistry.registerTool).not.toHaveBeenCalled();
  });

  it('should discover tools via mcpServerCommand', async () => {
    const commandString = 'my-mcp-server --start';
    const parsedCommand = ['my-mcp-server', '--start'] as ParseEntry[];
    mockConfig.getMcpServerCommand.mockReturnValue(commandString);
    vi.mocked(parse).mockReturnValue(parsedCommand);

    const mockTool = {
      name: 'tool1',
      description: 'desc1',
      inputSchema: { type: 'object' as const, properties: {} },
    };
    vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({
      tools: [mockTool],
    });

    // PRE-MOCK getToolsByServer for the expected server name
    // In this case, listTools fails, so no tools are registered.
    // The default mock `mockReturnValue([])` from beforeEach should apply.

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(parse).toHaveBeenCalledWith(commandString, process.env);
    expect(SdkClientStdioLib.StdioClientTransport).toHaveBeenCalledWith({
      command: parsedCommand[0],
      args: parsedCommand.slice(1),
      env: expect.any(Object),
      cwd: undefined,
      stderr: 'pipe',
    });
    expect(ClientLib.Client.prototype.connect).toHaveBeenCalledTimes(1);
    expect(mockToolRegistry.registerTool).toHaveBeenCalledTimes(1);
    expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
      expect.any(DiscoveredMCPTool),
    );
    const registeredTool = mockToolRegistry.registerTool.mock
      .calls[0][0] as DiscoveredMCPTool;
    expect(registeredTool.name).toBe('mcp__test-tool');
    expect(registeredTool.serverToolName).toBe('test-tool');
  });

  it('should discover tools via mcpServers config (stdio)', async () => {
    const serverConfig: MCPServerConfig = {
      command: './mcp-stdio',
      args: ['arg1'],
    };
    mockConfig.getMcpServers.mockReturnValue({ 'stdio-server': serverConfig });

    const mockTool = {
      name: 'tool-stdio',
      description: 'desc-stdio',
      inputSchema: { type: 'object' as const, properties: {} },
    };
    vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({
      tools: [mockTool],
    });

    // PRE-MOCK getToolsByServer for the expected server name
    mockToolRegistry.getToolsByServer.mockReturnValueOnce([
      expect.any(DiscoveredMCPTool),
    ]);

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(SdkClientStdioLib.StdioClientTransport).toHaveBeenCalledWith({
      command: serverConfig.command,
      args: serverConfig.args,
      env: expect.any(Object),
      cwd: undefined,
      stderr: 'pipe',
    });
    expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
      expect.any(DiscoveredMCPTool),
    );
    const registeredTool = mockToolRegistry.registerTool.mock
      .calls[0][0] as DiscoveredMCPTool;
    expect(registeredTool.name).toBe('stdio-server__test-tool');
  });

  it('should discover tools via mcpServers config (sse)', async () => {
    const serverConfig: MCPServerConfig = { url: 'http://localhost:1234/sse' };
    mockConfig.getMcpServers.mockReturnValue({ 'sse-server': serverConfig });

    const mockTool = {
      name: 'tool-sse',
      description: 'desc-sse',
      inputSchema: { type: 'object' as const, properties: {} },
    };
    vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({
      tools: [mockTool],
    });

    // PRE-MOCK getToolsByServer for the expected server name
    mockToolRegistry.getToolsByServer.mockReturnValueOnce([
      expect.any(DiscoveredMCPTool),
    ]);

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(SSEClientTransport).toHaveBeenCalledWith(new URL(serverConfig.url!), {});
    expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
      expect.any(DiscoveredMCPTool),
    );
    const registeredTool = mockToolRegistry.registerTool.mock
      .calls[0][0] as DiscoveredMCPTool;
    expect(registeredTool.name).toBe('sse-server__test-tool');
  });

  it('should discover tools via mcpServers config (streamable http)', async () => {
    const serverConfig: MCPServerConfig = {
      httpUrl: 'http://localhost:3000/mcp',
    };
    mockConfig.getMcpServers.mockReturnValue({ 'http-server': serverConfig });

    const mockTool = {
      name: 'tool-http',
      description: 'desc-http',
      inputSchema: { type: 'object' as const, properties: {} },
    };
    vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({
      tools: [mockTool],
    });

    mockToolRegistry.getToolsByServer.mockReturnValueOnce([
      expect.any(DiscoveredMCPTool),
    ]);

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL(serverConfig.httpUrl!),
      {},
    );
    expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
      expect.any(DiscoveredMCPTool),
    );
    const registeredTool = mockToolRegistry.registerTool.mock
      .calls[0][0] as DiscoveredMCPTool;
    expect(registeredTool.name).toBe('http-server__test-tool');
  });

  describe('StreamableHTTPClientTransport headers', () => {
    const setupHttpTest = async (headers?: Record<string, string>) => {
      const serverConfig: MCPServerConfig = {
        httpUrl: 'http://localhost:3000/mcp',
        ...(headers && { headers }),
      };
      const serverName = headers
        ? 'http-server-with-headers'
        : 'http-server-no-headers';
      const toolName = headers ? 'tool-http-headers' : 'tool-http-no-headers';

      mockConfig.getMcpServers.mockReturnValue({ [serverName]: serverConfig });

      const mockTool = {
        name: toolName,
        description: `desc-${toolName}`,
        inputSchema: { type: 'object' as const, properties: {} },
      };
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({
        tools: [mockTool],
      });
      mockToolRegistry.getToolsByServer.mockReturnValueOnce([
        expect.any(DiscoveredMCPTool),
      ]);

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        mockConfig.getMcpServerCommand(),
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      return { serverConfig };
    };

    it('should pass headers when provided', async () => {
      const headers = {
        Authorization: 'Bearer test-token',
        'X-Custom-Header': 'custom-value',
      };
      const { serverConfig } = await setupHttpTest(headers);

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL(serverConfig.httpUrl!),
        { requestInit: { headers } },
      );
    });

    it('should work without headers (backwards compatibility)', async () => {
      const { serverConfig } = await setupHttpTest();

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL(serverConfig.httpUrl!),
        {},
      );
    });

    it('should pass oauth token when provided', async () => {
      const headers = {
        Authorization: 'Bearer test-token',
      };
      const { serverConfig } = await setupHttpTest(headers);

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL(serverConfig.httpUrl!),
        { requestInit: { headers } },
      );
    });
  });

  it('should prefix tool names if multiple MCP servers are configured', async () => {
    const serverConfig1: MCPServerConfig = { command: './mcp1' };
    const serverConfig2: MCPServerConfig = { url: 'http://mcp2/sse' };
    mockConfig.getMcpServers.mockReturnValue({
      server1: serverConfig1,
      server2: serverConfig2,
    });

    const mockTool1 = {
      name: 'toolA', // Same original name
      description: 'd1',
      inputSchema: { type: 'object' as const, properties: {} },
    };
    const mockTool2 = {
      name: 'toolA', // Same original name
      description: 'd2',
      inputSchema: { type: 'object' as const, properties: {} },
    };
    const mockToolB = {
      name: 'toolB',
      description: 'dB',
      inputSchema: { type: 'object' as const, properties: {} },
    };

    vi.mocked(ClientLib.Client.prototype.listTools)
      .mockResolvedValueOnce({ tools: [mockTool1, mockToolB] }) // Tools for server1
      .mockResolvedValueOnce({ tools: [mockTool2] }); // Tool for server2 (toolA)

    // Mock the mcpToTool to return the right tools for each server
    vi.mocked(GenAiLib.mcpToTool)
      .mockReturnValueOnce({
        tool: () => ({
          functionDeclarations: [
            { name: 'toolA', description: 'Tool A', parameters: {} },
            { name: 'toolB', description: 'Tool B', parameters: {} },
          ]
        }),
      } as unknown as GenAiLib.CallableTool)
      .mockReturnValueOnce({
        tool: () => ({
          functionDeclarations: [
            { name: 'toolA', description: 'Tool A from server2', parameters: {} },
          ]
        }),
      } as unknown as GenAiLib.CallableTool);

    const effectivelyRegisteredTools = new Map<string, any>();

    mockToolRegistry.getTool.mockImplementation((toolName: string) =>
      effectivelyRegisteredTools.get(toolName),
    );

    // Store the original spy implementation if needed, or just let the new one be the behavior.
    // The mockToolRegistry.registerTool is already a vi.fn() from mockToolRegistryInstance.
    // We are setting its behavior for this test.
    mockToolRegistry.registerTool.mockImplementation((toolToRegister: any) => {
      // Simulate the actual registration name being stored for getTool to find
      effectivelyRegisteredTools.set(toolToRegister.name, toolToRegister);
      // If it's the first time toolA is registered (from server1, not prefixed),
      // also make it findable by its original name for the prefixing check of server2/toolA.
      if (
        toolToRegister.serverName === 'server1' &&
        toolToRegister.serverToolName === 'toolA' &&
        toolToRegister.name === 'toolA'
      ) {
        effectivelyRegisteredTools.set('toolA', toolToRegister);
      }
      // The spy call count is inherently tracked by mockToolRegistry.registerTool itself.
    });

    // PRE-MOCK getToolsByServer for the expected server names
    // This is for the final check in connectAndDiscover to see if any tools were registered *from that server*
    mockToolRegistry.getToolsByServer.mockImplementation(
      (serverName: string) => {
        if (serverName === 'server1')
          return [
            expect.objectContaining({ name: 'toolA' }),
            expect.objectContaining({ name: 'toolB' }),
          ];
        if (serverName === 'server2')
          return [expect.objectContaining({ name: 'server2__toolA' })];
        return [];
      },
    );

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(mockToolRegistry.registerTool).toHaveBeenCalledTimes(3);
    const registeredArgs = mockToolRegistry.registerTool.mock.calls.map(
      (call) => call[0],
    ) as DiscoveredMCPTool[];

    // The order of server processing by Promise.all is not guaranteed.
    // One 'toolA' will be unprefixed, the other will be prefixed.
    const toolA_from_server1 = registeredArgs.find(
      (t) => t.serverToolName === 'toolA' && t.serverName === 'server1',
    );
    const toolA_from_server2 = registeredArgs.find(
      (t) => t.serverToolName === 'toolA' && t.serverName === 'server2',
    );
    const toolB_from_server1 = registeredArgs.find(
      (t) => t.serverToolName === 'toolB' && t.serverName === 'server1',
    );

    expect(toolA_from_server1).toBeDefined();
    expect(toolA_from_server2).toBeDefined();
    expect(toolB_from_server1).toBeDefined();

    expect(toolB_from_server1?.name).toBe('server1__toolB'); // toolB gets prefixed with server name

    // Check that both toolA instances are prefixed since they have the same name
    expect(toolA_from_server1?.name).toBe('server1__toolA');
    expect(toolA_from_server2?.name).toBe('server2__toolA');
  });

  it('should clean schema properties ($schema, additionalProperties)', async () => {
    const serverConfig: MCPServerConfig = { command: './mcp-clean' };
    mockConfig.getMcpServers.mockReturnValue({ 'clean-server': serverConfig });

    const rawSchema = {
      type: 'object' as const,
      $schema: 'http://json-schema.org/draft-07/schema#',
      additionalProperties: true,
      properties: {
        prop1: { type: 'string', $schema: 'remove-this' },
        prop2: {
          type: 'object' as const,
          additionalProperties: false,
          properties: { nested: { type: 'number' } },
        },
      },
    };
    const mockTool = {
      name: 'cleanTool',
      description: 'd',
      inputSchema: JSON.parse(JSON.stringify(rawSchema)),
    };
    vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({
      tools: [mockTool],
    });
    // PRE-MOCK getToolsByServer for the expected server name
    mockToolRegistry.getToolsByServer.mockReturnValueOnce([
      expect.any(DiscoveredMCPTool),
    ]);

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(mockToolRegistry.registerTool).toHaveBeenCalledTimes(1);
    const registeredTool = mockToolRegistry.registerTool.mock
      .calls[0][0] as DiscoveredMCPTool;
    const cleanedParams = registeredTool.schema.parameters as any;

    expect(cleanedParams).not.toHaveProperty('$schema');
    expect(cleanedParams).not.toHaveProperty('additionalProperties');
    if (cleanedParams.properties?.prop1) {
      expect(cleanedParams.properties.prop1).not.toHaveProperty('$schema');
    }
    if (cleanedParams.properties?.prop2) {
      expect(cleanedParams.properties.prop2).not.toHaveProperty(
        'additionalProperties',
      );
      if (cleanedParams.properties.prop2.properties?.nested) {
        expect(cleanedParams.properties.prop2.properties.nested).not.toHaveProperty(
          '$schema',
        );
        expect(cleanedParams.properties.prop2.properties.nested).not.toHaveProperty(
          'additionalProperties',
        );
      }
    }
  });

  it('should handle error if mcpServerCommand parsing fails', async () => {
    const commandString = 'my-mcp-server "unterminated quote';
    mockConfig.getMcpServerCommand.mockReturnValue(commandString);
    vi.mocked(parse).mockImplementation(() => {
      throw new Error('Parsing failed');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        mockConfig.getMcpServerCommand(),
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      ),
    ).rejects.toThrow('Parsing failed');
    expect(mockToolRegistry.registerTool).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('should log error and skip server if config is invalid (missing url and command)', async () => {
    mockConfig.getMcpServers.mockReturnValue({ 'bad-server': {} as any });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "failed to start or connect to MCP server 'bad-server'",
      ),
    );
    // Client constructor should not be called if config is invalid before instantiation
    // Note: Client may be called during other tests, so we just check that no tools were registered
    expect(mockToolRegistry.registerTool).not.toHaveBeenCalled();
  });

  it('should log error and skip server if mcpClient.connect fails', async () => {
    const serverConfig: MCPServerConfig = { command: './mcp-fail-connect' };
    mockConfig.getMcpServers.mockReturnValue({
      'fail-connect-server': serverConfig,
    });
    vi.mocked(ClientLib.Client.prototype.connect).mockRejectedValue(
      new Error('Connection refused'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "failed to start or connect to MCP server 'fail-connect-server'",
      ),
    );
    expect(ClientLib.Client.prototype.listTools).not.toHaveBeenCalled();
    expect(mockToolRegistry.registerTool).not.toHaveBeenCalled();
  });

  it('should log error and skip server if mcpClient.listTools fails', async () => {
    const serverConfig: MCPServerConfig = { command: './mcp-fail-list' };
    mockConfig.getMcpServers.mockReturnValue({
      'fail-list-server': serverConfig,
    });
    
    // Mock discoverTools to throw an error
    vi.mocked(GenAiLib.mcpToTool).mockReturnValueOnce({
      tool: () => {
        throw new Error('ListTools error');
      },
    } as unknown as GenAiLib.CallableTool);
    
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Error connecting to MCP server 'fail-list-server':",
      ),
      expect.any(Error),
    );
    expect(mockToolRegistry.registerTool).not.toHaveBeenCalled();
  });

  it('should assign mcpClient.onerror handler', async () => {
    const serverConfig: MCPServerConfig = { command: './mcp-onerror' };
    mockConfig.getMcpServers.mockReturnValue({
      'onerror-server': serverConfig,
    });
    // PRE-MOCK getToolsByServer for the expected server name
    mockToolRegistry.getToolsByServer.mockReturnValueOnce([
      expect.any(DiscoveredMCPTool),
    ]);

    await discoverMcpTools(
      mockConfig.getMcpServers() ?? {},
      mockConfig.getMcpServerCommand(),
      mockToolRegistry as any,
      mockConfig.getDebugMode(),
    );

    const clientInstances = vi.mocked(ClientLib.Client).mock.results;
    expect(clientInstances.length).toBeGreaterThan(0);
    const lastClientInstance =
      clientInstances[clientInstances.length - 1]?.value;
    expect(lastClientInstance?.onerror).toEqual(expect.any(Function));
  });

  describe('OAuth Authentication Handling', () => {
    beforeEach(() => {
      // Mock MCPOAuthProvider and MCPOAuthTokenStorage
      vi.mock('../mcp/oauth-provider.js', () => ({
        MCPOAuthProvider: {
          getValidToken: vi.fn(),
          authenticate: vi.fn(),
        },
      }));

      vi.mock('../mcp/oauth-token-storage.js', () => ({
        MCPOAuthTokenStorage: {
          getToken: vi.fn(),
        },
      }));
    });

    it('should handle 401 Unauthorized response with automatic OAuth discovery', async () => {
      const serverConfig: MCPServerConfig = {
        httpUrl: 'https://api.example.com/mcp',
      };
      mockConfig.getMcpServers.mockReturnValue({
        'oauth-server': serverConfig,
      });

      // Mock 401 response with www-authenticate header
      const authError = new Error('401 Unauthorized');
      authError.message = `401 Unauthorized
www-authenticate: Bearer realm="MCP Server", resource_metadata_uri="https://auth.example.com/.well-known/oauth-protected-resource"`;

      vi.mocked(ClientLib.Client.prototype.connect).mockRejectedValueOnce(authError);

      // Mock OAuth discovery
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              authorization_servers: ['https://auth.example.com'],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              authorization_endpoint: 'https://auth.example.com/authorize',
              token_endpoint: 'https://auth.example.com/token',
            }),
        });

      // Mock successful authentication
      const { MCPOAuthProvider } = await import('../mcp/oauth-provider.js');
      vi.mocked(MCPOAuthProvider.authenticate).mockResolvedValue({
        accessToken: 'test_token',
        tokenType: 'Bearer',
      } as any);

      // Mock successful connection with OAuth token
      vi.mocked(ClientLib.Client.prototype.connect).mockResolvedValueOnce(undefined);
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({ tools: [] });

      vi.spyOn(console, 'log').mockImplementation(() => {});

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        undefined,
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('MCP server \'oauth-server\' requires OAuth authentication'),
      );
    });

    it('should use stored OAuth tokens for authenticated servers', async () => {
      const serverConfig: MCPServerConfig = {
        httpUrl: 'https://api.example.com/mcp',
      };
      mockConfig.getMcpServers.mockReturnValue({
        'oauth-server': serverConfig,
      });

      // Mock stored credentials
      const { MCPOAuthTokenStorage } = await import(
        '../mcp/oauth-token-storage.js'
      );
      const { MCPOAuthProvider } = await import('../mcp/oauth-provider.js');

      vi.mocked(MCPOAuthTokenStorage.getToken).mockResolvedValue({
        serverName: 'oauth-server',
        token: {
          accessToken: 'stored_token',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
        },
        clientId: 'test-client-id',
        tokenUrl: 'https://auth.example.com/token',
        updatedAt: Date.now(),
      });

      vi.mocked(MCPOAuthProvider.getValidToken).mockResolvedValue(
        'stored_token',
      );

      vi.mocked(ClientLib.Client.prototype.connect).mockResolvedValue(undefined);
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({ tools: [] });

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        undefined,
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(MCPOAuthProvider.getValidToken).toHaveBeenCalledWith(
        'oauth-server',
        { clientId: 'test-client-id' },
      );
    });

    it('should handle OAuth token refresh for expired tokens', async () => {
      const serverConfig: MCPServerConfig = {
        oauth: {
          enabled: true,
          clientId: 'test-client-id',
        },
        httpUrl: 'https://api.example.com/mcp',
      };
      mockConfig.getMcpServers.mockReturnValue({
        'oauth-server': serverConfig,
      });

      const { MCPOAuthProvider } = await import('../mcp/oauth-provider.js');

      // First call returns null (expired), second call returns refreshed token
      vi.mocked(MCPOAuthProvider.getValidToken)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('refreshed_token');

      // Mock connection to fail to trigger error path
      vi.mocked(ClientLib.Client.prototype.connect).mockRejectedValue(new Error('Connection failed'));
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({ tools: [] });

      vi.spyOn(console, 'error').mockImplementation(() => {});

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        undefined,
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error connecting to MCP server'),
        expect.any(Error),
      );
    });

    it('should handle SSE servers with OAuth tokens in Authorization header', async () => {
      const serverConfig: MCPServerConfig = {
        url: 'https://api.example.com/sse',
      };
      mockConfig.getMcpServers.mockReturnValue({
        'sse-oauth-server': serverConfig,
      });

      const { MCPOAuthTokenStorage } = await import(
        '../mcp/oauth-token-storage.js'
      );
      const { MCPOAuthProvider } = await import('../mcp/oauth-provider.js');

      vi.mocked(MCPOAuthTokenStorage.getToken).mockResolvedValue({
        serverName: 'sse-oauth-server',
        token: {
          accessToken: 'sse_token',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
        },
        clientId: 'test-client-id',
        tokenUrl: 'https://auth.example.com/token',
        updatedAt: Date.now(),
      });

      vi.mocked(MCPOAuthProvider.getValidToken).mockResolvedValue('refreshed_token');

      // Mock HTTP transport to fail so it falls back to SSE
      vi.mocked(ClientLib.Client.prototype.connect)
        .mockRejectedValueOnce(new Error('HTTP connection failed'))
        .mockResolvedValueOnce(undefined);

      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValue({ tools: [] });

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        undefined,
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(SSEClientTransport).toHaveBeenCalledWith(
        new URL('https://api.example.com/sse'),
        {
          requestInit: {
            headers: {
              Authorization: 'Bearer refreshed_token',
            },
          },
        },
      );
    });
  });

  describe('Tool Filtering', () => {
    const mockTools = [
      {
        name: 'toolA',
        description: 'descA',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'toolB',
        description: 'descB',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'toolC',
        description: 'descC',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];

    beforeEach(() => {
      // Reset mocks before each test
      vi.clearAllMocks();
      // Note: Individual tests will override this mock as needed
      mockToolRegistry.getToolsByServer.mockReturnValue([
        expect.any(DiscoveredMCPTool),
      ]);
    });

    it('should only include specified tools with includeTools', async () => {
      const serverConfig: MCPServerConfig = {
        command: './mcp-include',
        includeTools: ['toolA', 'toolC'],
      };
      mockConfig.getMcpServers.mockReturnValue({
        'include-server': serverConfig,
      });

      // Override the global mock to provide specific tools for this test
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValueOnce({
        tools: mockTools,
      });

      // Override the mcpToTool mock to return the right tools
      const _mockMcpToTool = vi.mocked(GenAiLib.mcpToTool).mockReturnValueOnce({
        tool: () => ({
          functionDeclarations: mockTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }))
        }),
      } as unknown as GenAiLib.CallableTool);

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        mockConfig.getMcpServerCommand(),
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(mockToolRegistry.registerTool).toHaveBeenCalledTimes(2);
      expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolA' }),
      );
      expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolC' }),
      );
      expect(mockToolRegistry.registerTool).not.toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolB' }),
      );
    });

    it('should exclude specified tools with excludeTools', async () => {
      const serverConfig: MCPServerConfig = {
        command: './mcp-exclude',
        excludeTools: ['toolB'],
      };
      mockConfig.getMcpServers.mockReturnValue({
        'exclude-server': serverConfig,
      });

      // Override the global mock to provide specific tools for this test
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValueOnce({
        tools: mockTools,
      });

      // Override the mcpToTool mock to return the right tools
      const _mockMcpToTool = vi.mocked(GenAiLib.mcpToTool).mockReturnValueOnce({
        tool: () => ({
          functionDeclarations: mockTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }))
        }),
      } as unknown as GenAiLib.CallableTool);

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        mockConfig.getMcpServerCommand(),
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(mockToolRegistry.registerTool).toHaveBeenCalledTimes(2);
      expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolA' }),
      );
      expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolC' }),
      );
      expect(mockToolRegistry.registerTool).not.toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolB' }),
      );
    });

    it('should handle both includeTools and excludeTools', async () => {
      const serverConfig: MCPServerConfig = {
        command: './mcp-both',
        includeTools: ['toolA', 'toolB'],
        excludeTools: ['toolB'],
      };
      mockConfig.getMcpServers.mockReturnValue({ 'both-server': serverConfig });

      // Override the global mock to provide specific tools for this test
      vi.mocked(ClientLib.Client.prototype.listTools).mockResolvedValueOnce({
        tools: mockTools,
      });

      // Override the mcpToTool mock to return the right tools
      const _mockMcpToTool = vi.mocked(GenAiLib.mcpToTool).mockReturnValueOnce({
        tool: () => ({
          functionDeclarations: mockTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }))
        }),
      } as unknown as GenAiLib.CallableTool);

      await discoverMcpTools(
        mockConfig.getMcpServers() ?? {},
        mockConfig.getMcpServerCommand(),
        mockToolRegistry as any,
        mockConfig.getDebugMode(),
      );

      expect(mockToolRegistry.registerTool).toHaveBeenCalledTimes(1);
      expect(mockToolRegistry.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolA' }),
      );
      expect(mockToolRegistry.registerTool).not.toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolB' }),
      );
      expect(mockToolRegistry.registerTool).not.toHaveBeenCalledWith(
        expect.objectContaining({ serverToolName: 'toolC' }),
      );
    });
  });
});
describe('sanitizeParameters', () => {
  it('should do nothing for an undefined schema', () => {
    const schema = undefined;
    sanitizeParameters(schema);
  });

  it('should remove default when anyOf is present', () => {
    const schema: Schema = {
      anyOf: [{ type: Type.STRING }, { type: Type.NUMBER }],
      default: 'hello',
    };
    sanitizeParameters(schema);
    expect(schema.default).toBeUndefined();
  });

  it('should recursively sanitize items in anyOf', () => {
    const schema: Schema = {
      anyOf: [
        {
          anyOf: [{ type: Type.STRING }],
          default: 'world',
        },
        { type: Type.NUMBER },
      ],
    };
    sanitizeParameters(schema);
    expect(schema.anyOf![0].default).toBeUndefined();
  });

  it('should recursively sanitize items in items', () => {
    const schema: Schema = {
      items: {
        anyOf: [{ type: Type.STRING }],
        default: 'world',
      },
    };
    sanitizeParameters(schema);
    expect(schema.items!.default).toBeUndefined();
  });

  it('should recursively sanitize items in properties', () => {
    const schema: Schema = {
      properties: {
        prop1: {
          anyOf: [{ type: Type.STRING }],
          default: 'world',
        },
      },
    };
    sanitizeParameters(schema);
    expect(schema.properties!.prop1.default).toBeUndefined();
  });

  it('should handle complex nested schemas', () => {
    const schema: Schema = {
      properties: {
        prop1: {
          items: {
            anyOf: [{ type: Type.STRING }],
            default: 'world',
          },
        },
        prop2: {
          anyOf: [
            { type: Type.STRING },
            { type: Type.NUMBER },
          ],
          default: 'nested',
        },
      },
    };
    sanitizeParameters(schema);
    expect(schema.properties!.prop1.items!.default).toBeUndefined();
    expect(schema.properties!.prop2.default).toBeUndefined();
  });
});

describe('discoverTools', () => {
  it('should discover tools', async () => {
    // Clear the mock before this test
    vi.clearAllMocks();
    
    const mockedClient = {} as unknown as ClientLib.Client;
    const mockedMcpToTool = vi.mocked(GenAiLib.mcpToTool).mockReturnValueOnce({
      tool: () => ({
        functionDeclarations: [
          {
            name: 'testFunction',
          },
        ],
      }),
    } as unknown as GenAiLib.CallableTool);

    const tools = await discoverTools('test-server', {}, mockedClient);

    expect(tools.length).toBe(1);
    expect(mockedMcpToTool).toHaveBeenCalledTimes(1);
  });
});

describe('appendMcpServerCommand', () => {
    it('should do nothing if no MCP servers or command are configured', () => {
      const out = populateMcpServerCommand({}, undefined);
      expect(out).toEqual({});
    });

    it('should discover tools via mcpServerCommand', () => {
      const commandString = 'command --arg1 value1';
      vi.mocked(parse).mockReturnValue(['command', '--arg1', 'value1']);
      const out = populateMcpServerCommand({}, commandString);
      expect(out).toEqual({
        mcp: {
          command: 'command',
          args: ['--arg1', 'value1'],
        },
      });
    });

    it('should handle error if mcpServerCommand parsing fails', () => {
      // Mock parse to return non-string values to trigger the error
      vi.mocked(parse).mockReturnValue(['command', { type: 'glob', pattern: '*' }] as any);
      expect(() => populateMcpServerCommand({}, 'derp && herp')).toThrowError();
    });
  });

  describe('createTransport', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = {};
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    describe('should connect via httpUrl', () => {
      it('without headers', async () => {
        const transport = createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(new URL('http://test-server'), {});
      });

      it('with headers', async () => {
        const transport = createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            headers: { Authorization: 'derp' },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(new URL('http://test-server'), {
          requestInit: {
            headers: { Authorization: 'derp' },
          },
        });
      });
    });

    describe('should connect via url', () => {
      it('without headers', async () => {
        const transport = createTransport(
          'test-server',
          {
            url: 'http://test-server',
          },
          false,
        );
        expect(transport).toBeInstanceOf(SSEClientTransport);
        expect(SSEClientTransport).toHaveBeenCalledWith(new URL('http://test-server'), {});
      });

      it('with headers', async () => {
        const transport = createTransport(
          'test-server',
          {
            url: 'http://test-server',
            headers: { Authorization: 'derp' },
          },
          false,
        );

        expect(transport).toBeInstanceOf(SSEClientTransport);
        expect(SSEClientTransport).toHaveBeenCalledWith(new URL('http://test-server'), {
          requestInit: {
            headers: { Authorization: 'derp' },
          },
        });
      });
    });

    it('should connect via command', () => {
      const mockedTransport = vi.mocked(SdkClientStdioLib.StdioClientTransport);

      createTransport(
        'test-server',
        {
          command: 'test-command',
          args: ['--foo', 'bar'],
          env: { FOO: 'bar' },
          cwd: 'test/cwd',
        },
        false,
      );

      expect(mockedTransport).toHaveBeenCalledWith({
        command: 'test-command',
        args: ['--foo', 'bar'],
        cwd: 'test/cwd',
        env: { FOO: 'bar' },
        stderr: 'pipe',
      });
    });
  });

  describe('generateValidName', () => {
    it('should return a valid name for a simple function', () => {
      const funcDecl = { name: 'myFunction' };
      const serverName = 'myServer';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe('myServer__myFunction');
    });

    it('should prepend the server name', () => {
      const funcDecl = { name: 'anotherFunction' };
      const serverName = 'production-server';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe('production-server__anotherFunction');
    });

    it('should replace invalid characters with underscores', () => {
      const funcDecl = { name: 'invalid-name with spaces' };
      const serverName = 'test_server';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe('test_server__invalid-name_with_spaces');
    });

    it('should truncate long names', () => {
      const funcDecl = {
        name: 'a_very_long_function_name_that_will_definitely_exceed_the_limit',
      };
      const serverName = 'a_long_server_name';
      const result = generateValidName(funcDecl, serverName);
      expect(result.length).toBe(63);
      expect(result).toBe(
        'a_long_server_name__a_very_l___will_definitely_exceed_the_limit',
      );
    });

    it('should handle names with only invalid characters', () => {
      const funcDecl = { name: '!@#$%^&*()' };
      const serverName = 'special-chars';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe('special-chars____________');
    });

    it('should handle names that are already valid', () => {
      const funcDecl = { name: 'already_valid' };
      const serverName = 'validator';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe('validator__already_valid');
    });

    it('should handle names with leading/trailing invalid characters', () => {
      const funcDecl = { name: '-_invalid-_' };
      const serverName = 'trim-test';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe('trim-test__-_invalid-_');
    });

    it('should handle names that are exactly 63 characters long', () => {
      const longName = 'a'.repeat(45);
      const funcDecl = { name: longName };
      const serverName = 'server';
      const result = generateValidName(funcDecl, serverName);
      expect(result).toBe(`server__${longName}`);
      expect(result.length).toBe(53);
    });

    it('should handle names that are exactly 64 characters long', () => {
      const longName = 'a'.repeat(55);
      const funcDecl = { name: longName };
      const serverName = 'server';
      const result = generateValidName(funcDecl, serverName);
      expect(result.length).toBe(63);
      expect(result).toBe(
        'server__aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
    });

    it('should handle names that are longer than 64 characters', () => {
      const longName = 'a'.repeat(100);
      const funcDecl = { name: longName };
      const serverName = 'long-server';
      const result = generateValidName(funcDecl, serverName);
      expect(result.length).toBe(63);
      expect(result).toBe(
        'long-server__aaaaaaaaaaaaaaa___aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
    });
  });

  describe('isEnabled', () => {
    const funcDecl = { name: 'myTool' };
    const serverName = 'myServer';

    it('should return true if no include or exclude lists are provided', () => {
      const mcpServerConfig = {};
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(true);
    });

    it('should return false if the tool is in the exclude list', () => {
      const mcpServerConfig = { excludeTools: ['myTool'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(false);
    });

    it('should return true if the tool is in the include list', () => {
      const mcpServerConfig = { includeTools: ['myTool'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(true);
    });

    it('should return true if the tool is in the include list with parentheses', () => {
      const mcpServerConfig = { includeTools: ['myTool()'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(true);
    });

    it('should return false if the include list exists but does not contain the tool', () => {
      const mcpServerConfig = { includeTools: ['anotherTool'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(false);
    });

    it('should return false if the tool is in both the include and exclude lists', () => {
      const mcpServerConfig = {
        includeTools: ['myTool'],
        excludeTools: ['myTool'],
      };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(false);
    });

    it('should return false if the function declaration has no name', () => {
      const namelessFuncDecl = {};
      const mcpServerConfig = {};
      expect(isEnabled(namelessFuncDecl, serverName, mcpServerConfig)).toBe(
        false,
      );
    });
  });
