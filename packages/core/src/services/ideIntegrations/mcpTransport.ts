/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDEIntegrationConfig, ActiveFileContext } from './types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Generic MCP transport that can connect to any MCP-compatible IDE server.
 *
 * This transport discovers IDE MCP servers through various methods:
 * - Environment variables (GEMINI_CLI_IDE_SERVER_PORT, etc.)
 * - Well-known ports
 * - Process detection
 * - Configuration files
 *
 * Once connected, it provides a standard interface for IDE communication
 * regardless of which specific IDE is running the MCP server.
 */
export class MCPTransport {
  private config: IDEIntegrationConfig;
  private mcpClient: Client | null = null;
  private serverUrl: URL | null = null;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    const serverUrl = this.discoverMCPServer();
    if (!serverUrl) {
      return false;
    }

    try {
      // Try to connect to the MCP server to verify it's available
      const response = await fetch(serverUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout ?? 5000),
      });

      // MCP servers typically return 400 for GET requests on the MCP endpoint
      return response.status === 400;
    } catch (error) {
      if (this.config.debug) {
        console.debug(
          `MCP server not available at ${serverUrl}:`,
          error instanceof Error ? error.message : error,
        );
      }
      return false;
    }
  }

  async initialize(): Promise<void> {
    this.serverUrl = this.discoverMCPServer();
    if (!this.serverUrl) {
      throw new Error(
        'No MCP-compatible IDE server found. Make sure your IDE is running with MCP support enabled.',
      );
    }

    if (this.mcpClient) {
      return; // Already initialized
    }

    try {
      this.mcpClient = new Client(
        {
          name: 'gemini-cli-ide-integration',
          version: '1.0.0',
        },
        {},
      );

      const transport = new StreamableHTTPClientTransport(this.serverUrl);
      await this.mcpClient.connect(transport, {
        timeout: this.config.timeout ?? 10000,
      });

      // Set up error handler
      this.mcpClient.onerror = (error: Error) => {
        if (this.config.debug) {
          console.error('MCP client error:', error.toString());
        }
      };

      if (this.config.debug) {
        console.debug(`Connected to MCP server at ${this.serverUrl}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to connect to MCP server at ${this.serverUrl}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      try {
        this.mcpClient.close();
        if (this.config.debug) {
          console.debug('Closed MCP client connection');
        }
      } catch (error) {
        if (this.config.debug) {
          console.warn(
            'Error closing MCP client:',
            error instanceof Error ? error.message : error,
          );
        }
      }
      this.mcpClient = null;
    }
  }

  async getActiveFile(): Promise<ActiveFileContext | null> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }

    try {
      const result = await this.mcpClient.callTool(
        {
          name: 'getActiveFile',
          arguments: {},
        },
        undefined,
        { timeout: this.config.timeout ?? 5000 },
      );

      // Parse the MCP response
      if (!Array.isArray(result.content) || result.content.length === 0) {
        return null;
      }

      const content = result.content[0];
      if (content.type !== 'text') {
        return null;
      }

      // Parse the active file information
      // Expected format: "Active file: /path/to/file.ts"
      // Or with cursor: "Active file: /path/to/file.ts (line: 10, char: 5)"
      const match = content.text.match(
        /Active file: (.+?)(?:\s*\(line: (\d+), char: (\d+)\))?$/,
      );
      if (!match) {
        return null;
      }

      const filePath = match[1].trim();
      if (!filePath || filePath === 'No file is currently active') {
        return null;
      }

      const result_context: ActiveFileContext = {
        filePath,
      };

      if (match[2] && match[3]) {
        result_context.cursor = {
          line: parseInt(match[2], 10),
          character: parseInt(match[3], 10),
        };
      }

      return result_context;
    } catch (error) {
      if (this.config.debug) {
        console.warn(
          'Error getting active file from IDE:',
          error instanceof Error ? error.message : error,
        );
      }
      return null;
    }
  }

  setNotificationHandler(
    _handler: (context: ActiveFileContext | null) => void,
  ): void {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }

    // Set up handler for active file change notifications
    // Note: MCP notification handling implementation may need adjustment based on actual MCP SDK
    try {
      // This is a placeholder - actual implementation depends on MCP SDK notification system
      if (this.config.debug) {
        console.debug(
          'MCP notification handler set up (placeholder implementation)',
        );
      }

      // Store handler for future use when MCP notification system is properly implemented
      // The actual implementation will depend on the specific MCP SDK being used
    } catch (error) {
      if (this.config.debug) {
        console.warn(
          'Could not set up MCP notification handler:',
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  async sendNotification(message: string): Promise<void> {
    // For now, just log the notification - IDEs can implement this as needed
    if (this.config.debug) {
      console.debug('IDE notification (MCP):', message);
    }
  }

  /**
   * Discover available MCP servers through various methods
   */
  private discoverMCPServer(): URL | null {
    // Method 1: Check environment variable (primary method)
    const portFromEnv = this.config.environment.GEMINI_CLI_IDE_SERVER_PORT;
    if (portFromEnv) {
      const port = parseInt(portFromEnv, 10);
      if (port > 0 && port < 65536) {
        return new URL(`http://localhost:${port}/mcp`);
      }
    }

    // Method 2: Try well-known ports for IDE MCP servers
    const wellKnownPorts = [
      58767, // Common MCP port
      3000, // Development server port
      8080, // Alternative HTTP port
    ];

    for (const port of wellKnownPorts) {
      // We'll return the first well-known port and let isAvailable() test connectivity
      return new URL(`http://localhost:${port}/mcp`);
    }

    return null;
  }
}
