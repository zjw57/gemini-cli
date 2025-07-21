/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from '../types.js';
import { VSCodeMCPTransport } from './mcpTransport.js';

/**
 * VS Code integration implementation using Model Context Protocol (MCP).
 * This integration communicates with the VS Code companion extension via HTTP transport.
 */
export class VSCodeIntegration implements IDEIntegration {
  private transport: VSCodeMCPTransport;
  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.transport = new VSCodeMCPTransport(config);
  }

  /**
   * Check if VS Code is available and the companion extension is running
   */
  async isAvailable(): Promise<boolean> {
    // Check if we're running in VS Code environment
    const isVSCodeEnv = this.config.environment.TERM_PROGRAM === 'vscode';
    if (!isVSCodeEnv) {
      if (this.config.debug) {
        console.debug(
          'Not running in VS Code environment (TERM_PROGRAM !== "vscode")',
        );
      }
      return false;
    }

    // Check if the MCP server port is available
    return await this.transport.isAvailable();
  }

  /**
   * Get the currently active file context from VS Code
   */
  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    try {
      const activeFile = await this.transport.getActiveFile();

      if (!activeFile || !activeFile.filePath) {
        return null;
      }

      return {
        filePath: activeFile.filePath,
        cursor: activeFile.cursor,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error getting active file context from VS Code:', error);
      }
      return null;
    }
  }

  /**
   * Send a notification to VS Code
   */
  async sendNotification(message: string): Promise<void> {
    try {
      return await this.transport.sendNotification(message);
    } catch (error) {
      // Notification errors should not be fatal
      if (this.config.debug) {
        console.warn('Error sending notification to VS Code:', error);
      }
    }
  }

  /**
   * Initialize the VS Code integration
   */
  async initialize(): Promise<void> {
    if (this.config.debug) {
      console.debug('Initializing VS Code integration...');
    }

    try {
      await this.transport.initialize();

      if (this.config.debug) {
        console.debug('VS Code integration initialized successfully');
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('Failed to initialize VS Code integration:', error);
      }
      throw error;
    }
  }

  /**
   * Clean up VS Code integration resources
   */
  async cleanup(): Promise<void> {
    if (this.config.debug) {
      console.debug('Cleaning up VS Code integration...');
    }

    try {
      await this.transport.cleanup();

      if (this.config.debug) {
        console.debug('VS Code integration cleaned up successfully');
      }
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error during VS Code integration cleanup:', error);
      }
    }
  }

  /**
   * Set up a handler for active file change notifications from VS Code
   */
  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this.transport.setNotificationHandler((params) => {
      if (params.filePath) {
        handler({
          filePath: params.filePath,
          cursor: params.cursor,
        });
      } else {
        handler(null);
      }
    });
  }

  /**
   * Get the underlying MCP client for advanced operations (if needed)
   */
  getMCPClient() {
    return this.transport.getMCPClient();
  }
}
