/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createMCPIDEIntegration } from './mcpIntegration.js';
import { IDEIntegration, IDEIntegrationConfig } from './types.js';
import { ideContext } from '../ideContext.js';

/**
 * Manages the generic MCP-based IDE integration.
 *
 * This simplified manager works with any MCP-compatible IDE without needing
 * to know specific IDE details. The MCP protocol handles the abstraction.
 */
export class IDEIntegrationManager {
  private static instance: IDEIntegrationManager;
  private activeIntegration: IDEIntegration | null = null;
  private initialized = false;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of the IDE integration manager
   */
  static getInstance(): IDEIntegrationManager {
    if (!IDEIntegrationManager.instance) {
      IDEIntegrationManager.instance = new IDEIntegrationManager();
    }
    return IDEIntegrationManager.instance;
  }

  /**
   * Initialize the IDE integration manager and connect to any available MCP-compatible IDE
   */
  async initialize(config: IDEIntegrationConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create the generic MCP integration
    try {
      const integration = await createMCPIDEIntegration(config);

      // Check if any MCP-compatible IDE is available
      if (await integration.isAvailable()) {
        await this.connectToIntegration(integration);
        this.activeIntegration = integration;

        if (config.debug) {
          console.debug('Successfully connected to MCP-compatible IDE');
        }
      } else {
        // Clean up if no IDE is available
        await integration.cleanup();

        if (config.debug) {
          console.debug('No MCP-compatible IDE found');
        }
      }
    } catch (error) {
      if (config.debug) {
        console.debug('Failed to initialize IDE integration:', error);
      }
    }

    this.initialized = true;
  }

  /**
   * Connect to the MCP integration and set up event handlers
   */
  private async connectToIntegration(
    integration: IDEIntegration,
  ): Promise<void> {
    // Initialize the MCP connection
    await integration.initialize();

    // Set up notification handler for active file changes from any MCP-compatible IDE
    integration.setActiveFileChangeHandler((context) => {
      if (context) {
        // Update the existing ideContext system with file context from the IDE
        ideContext.setActiveFileContext({
          filePath: context.filePath,
          cursor: context.cursor,
        });
      } else {
        ideContext.clearActiveFileContext();
      }
    });

    // Get initial active file context
    try {
      const initialContext = await integration.getActiveFileContext();
      if (initialContext) {
        ideContext.setActiveFileContext({
          filePath: initialContext.filePath,
          cursor: initialContext.cursor,
        });
      }
    } catch (_error) {
      // Don't fail initialization if we can't get initial context
      // Note: config is not stored as instance variable in protocol-first design
    }
  }

  /**
   * Get the currently active IDE integration
   */
  getActiveIntegration(): IDEIntegration | null {
    return this.activeIntegration;
  }

  /**
   * Check if any IDE integration is currently active
   */
  isActive(): boolean {
    return this.activeIntegration !== null;
  }

  /**
   * Get the status of the current integration
   */
  async getStatus(): Promise<{
    active: boolean;
    integration?: {
      type: string;
      available: boolean;
    };
  }> {
    if (!this.activeIntegration) {
      return { active: false };
    }

    try {
      const available = await this.activeIntegration.isAvailable();
      return {
        active: true,
        integration: {
          type: 'mcp',
          available,
        },
      };
    } catch (_error) {
      return {
        active: true,
        integration: {
          type: 'mcp',
          available: false,
        },
      };
    }
  }

  /**
   * Clean up the MCP IDE integration
   */
  async cleanup(): Promise<void> {
    if (this.activeIntegration) {
      try {
        await this.activeIntegration.cleanup();
      } catch (error) {
        console.warn('Error cleaning up active IDE integration:', error);
      }
      this.activeIntegration = null;
    }

    ideContext.clearActiveFileContext();
    this.initialized = false;
  }

  /**
   * Manually connect to the MCP IDE integration
   * In protocol-first design, there's only one integration type (MCP)
   */
  async connectToMCP(config: IDEIntegrationConfig): Promise<boolean> {
    try {
      // Clean up current integration first
      if (this.activeIntegration) {
        await this.activeIntegration.cleanup();
        this.activeIntegration = null;
      }

      const integration = await createMCPIDEIntegration(config);

      if (await integration.isAvailable()) {
        await this.connectToIntegration(integration);
        this.activeIntegration = integration;
        return true;
      } else {
        await integration.cleanup();
        return false;
      }
    } catch (error) {
      if (config.debug) {
        console.error('Failed to connect to MCP integration:', error);
      }
      return false;
    }
  }
}
