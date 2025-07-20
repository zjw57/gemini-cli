/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ideIntegrationRegistry } from './index.js';
import { vscodeIntegrationFactory } from './vscode/index.js';
import { VSCodeIntegration } from './vscode/vscodeIntegration.js';
import { IDEIntegration, IDEIntegrationConfig } from './types.js';
import { ideContext } from '../ideContext.js';

/**
 * Manages IDE integrations and coordinates them with the existing ideContext system.
 * This class serves as a bridge between the new plugin system and the existing
 * IDE context management.
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
   * Initialize the IDE integration manager and detect available IDEs
   */
  async initialize(config: IDEIntegrationConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Register built-in IDE integrations
    if (!ideIntegrationRegistry.isRegistered('vscode')) {
      ideIntegrationRegistry.register('vscode', vscodeIntegrationFactory);
    }

    // Try to detect and connect to an available IDE
    await this.detectAndConnect(config);

    this.initialized = true;
  }

  /**
   * Detect available IDEs and connect to the first one found
   */
  private async detectAndConnect(config: IDEIntegrationConfig): Promise<void> {
    // For now, we only support VS Code, but this can be extended
    const integrationIds = ['vscode'];

    for (const id of integrationIds) {
      try {
        if (config.debug) {
          console.debug(`Checking availability of ${id} IDE integration...`);
        }

        const integration = await ideIntegrationRegistry.create(id, config);

        if (await integration.isAvailable()) {
          await this.connectToIntegration(integration);
          this.activeIntegration = integration;

          if (config.debug) {
            console.debug(
              `Successfully connected to ${integration.name} integration`,
            );
          }
          return;
        } else {
          // Clean up if not available
          await integration.cleanup();
          ideIntegrationRegistry.unregister(id);
        }
      } catch (error) {
        if (config.debug) {
          console.debug(`Failed to connect to ${id} integration:`, error);
        }
      }
    }

    if (config.debug) {
      console.debug('No IDE integrations available');
    }
  }

  /**
   * Connect to a specific IDE integration and set up event handlers
   */
  private async connectToIntegration(
    integration: IDEIntegration,
  ): Promise<void> {
    // Set up notification handler for active file changes
    if (integration instanceof VSCodeIntegration) {
      integration.setActiveFileChangeHandler((context) => {
        if (context) {
          // Convert from new ActiveFileContext to legacy ActiveFile format
          ideContext.setActiveFileContext({
            filePath: context.filePath,
            cursor: context.cursor,
          });
        } else {
          ideContext.clearActiveFileContext();
        }
      });
    }

    // Get initial active file context
    try {
      const initialContext = await integration.getActiveFileContext();
      if (initialContext) {
        ideContext.setActiveFileContext({
          filePath: initialContext.filePath,
          cursor: initialContext.cursor,
        });
      }
    } catch (error) {
      // Don't fail initialization if we can't get initial context
      console.debug('Could not get initial active file context:', error);
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
      id: string;
      name: string;
      description: string;
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
          id: this.activeIntegration.id,
          name: this.activeIntegration.name,
          description: this.activeIntegration.description,
          available,
        },
      };
    } catch (_error) {
      return {
        active: true,
        integration: {
          id: this.activeIntegration.id,
          name: this.activeIntegration.name,
          description: this.activeIntegration.description,
          available: false,
        },
      };
    }
  }

  /**
   * Clean up all IDE integrations
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

    await ideIntegrationRegistry.cleanup();
    ideContext.clearActiveFileContext();
    this.initialized = false;
  }

  /**
   * Manually connect to a specific IDE integration by ID
   */
  async connectToIDE(
    ideId: string,
    config: IDEIntegrationConfig,
  ): Promise<boolean> {
    try {
      // Clean up current integration first
      if (this.activeIntegration) {
        await this.activeIntegration.cleanup();
        this.activeIntegration = null;
      }

      const integration = await ideIntegrationRegistry.create(ideId, config);

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
        console.error(`Failed to connect to ${ideId} integration:`, error);
      }
      return false;
    }
  }
}
