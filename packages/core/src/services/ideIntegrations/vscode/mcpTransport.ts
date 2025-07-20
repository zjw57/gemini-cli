/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ActiveFileNotificationSchema } from '../../ideContext.js';
import { IDEIntegrationConfig } from '../types.js';
import { getErrorMessage } from '../../../utils/errors.js';

const IDE_SERVER_PORT_ENV_VAR = 'GEMINI_CLI_IDE_SERVER_PORT';
const DEFAULT_TIMEOUT = 10000; // 10 seconds

/**
 * MCP transport layer for VS Code integration.
 * Handles the HTTP-based MCP communication with the VS Code companion extension.
 */
export class VSCodeMCPTransport {
  private mcpClient: Client | null = null;
  private port: number | null = null;
  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.port = this.discoverPort();
  }

  /**
   * Discover the port from environment variables set by VS Code extension
   */
  private discoverPort(): number | null {
    const portStr = this.config.environment[IDE_SERVER_PORT_ENV_VAR];
    if (!portStr) {
      return null;
    }

    const port = parseInt(portStr, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      if (this.config.debug) {
        console.warn(`Invalid port in ${IDE_SERVER_PORT_ENV_VAR}: ${portStr}`);
      }
      return null;
    }

    return port;
  }

  /**
   * Check if VS Code extension is available by testing the port
   */
  async isAvailable(): Promise<boolean> {
    if (!this.port) {
      return false;
    }

    try {
      // Simple HTTP GET to test if server is responding
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`http://localhost:${this.port}/mcp`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // VS Code extension should respond to GET requests
      return response.status === 400; // Expected response for GET without session ID
    } catch (error) {
      if (this.config.debug) {
        console.debug(
          `VS Code MCP server not available on port ${this.port}:`,
          getErrorMessage(error),
        );
      }
      return false;
    }
  }

  /**
   * Initialize the MCP connection to VS Code
   */
  async initialize(): Promise<void> {
    if (!this.port) {
      throw new Error(
        `VS Code integration not available: ${IDE_SERVER_PORT_ENV_VAR} environment variable not set`,
      );
    }

    if (this.mcpClient) {
      if (this.config.debug) {
        console.debug('VS Code MCP client already initialized');
      }
      return;
    }

    try {
      this.mcpClient = new Client({
        name: 'gemini-cli-vscode-integration',
        version: '1.0.0',
      });

      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${this.port}/mcp`),
      );

      await this.mcpClient.connect(transport, {
        timeout: this.config.timeout || DEFAULT_TIMEOUT,
      });

      if (this.config.debug) {
        console.debug(`Connected to VS Code MCP server on port ${this.port}`);
      }

      // Set up error handling
      this.mcpClient.onerror = (error) => {
        if (this.config.debug) {
          console.error('VS Code MCP client error:', error.toString());
        }
      };
    } catch (error) {
      throw new Error(
        `Failed to connect to VS Code MCP server: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Clean up MCP connection
   */
  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      try {
        this.mcpClient.close();
        if (this.config.debug) {
          console.debug('Closed VS Code MCP client connection');
        }
      } catch (error) {
        if (this.config.debug) {
          console.warn(
            'Error closing VS Code MCP client:',
            getErrorMessage(error),
          );
        }
      } finally {
        this.mcpClient = null;
      }
    }
  }

  /**
   * Get the active file information from VS Code via MCP
   */
  async getActiveFile(): Promise<{
    filePath: string;
    cursor?: { line: number; character: number };
  } | null> {
    if (!this.mcpClient) {
      throw new Error('VS Code MCP client not initialized');
    }

    try {
      const result = await this.mcpClient.callTool(
        {
          name: 'getActiveFile',
          arguments: {},
        },
        undefined,
        { timeout: this.config.timeout || DEFAULT_TIMEOUT },
      );

      // Parse the response to extract file path
      const content = Array.isArray(result.content)
        ? result.content[0]
        : undefined;
      if (content?.type === 'text' && content.text) {
        const text = content.text;

        if (text.includes('No file is currently active')) {
          return null;
        }

        // Extract file path from "Active file: /path/to/file"
        const match = text.match(/Active file: (.+)/);
        if (match && match[1]) {
          return {
            filePath: match[1].trim(),
            // Note: VS Code extension doesn't currently provide cursor position
            // This could be enhanced in the future
          };
        }
      }

      return null;
    } catch (error) {
      if (this.config.debug) {
        console.warn(
          'Error getting active file from VS Code:',
          getErrorMessage(error),
        );
      }
      return null;
    }
  }

  /**
   * Set up notification handler for active file changes
   */
  setNotificationHandler(
    handler: (params: {
      filePath: string;
      cursor?: { line: number; character: number };
    }) => void,
  ): void {
    if (!this.mcpClient) {
      throw new Error('VS Code MCP client not initialized');
    }

    this.mcpClient.setNotificationHandler(
      ActiveFileNotificationSchema,
      (notification) => {
        handler(notification.params);
      },
    );
  }

  /**
   * Send a notification to VS Code (if supported by the extension)
   */
  async sendNotification(message: string): Promise<void> {
    // Note: Current VS Code extension doesn't support receiving notifications
    // This is a placeholder for future enhancement
    if (this.config.debug) {
      console.debug(`VS Code notification (not implemented): ${message}`);
    }

    // For now, we could potentially use VS Code's output channel or status bar
    // but that would require extending the MCP server in the extension
  }

  /**
   * Get the current MCP client (for advanced usage)
   */
  getMCPClient(): Client | null {
    return this.mcpClient;
  }
}
