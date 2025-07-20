/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IDEIntegration,
  IDEIntegrationFactory,
  IDEIntegrationConfig,
} from './types.js';

/**
 * Registry for managing IDE integrations. This class maintains a collection of
 * available IDE integrations and provides methods to discover, register, and
 * create IDE integration instances.
 */
export class IDEIntegrationRegistry {
  private static instance: IDEIntegrationRegistry;
  private factories = new Map<string, IDEIntegrationFactory>();
  private integrations = new Map<string, IDEIntegration>();

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of the IDE integration registry
   */
  static getInstance(): IDEIntegrationRegistry {
    if (!IDEIntegrationRegistry.instance) {
      IDEIntegrationRegistry.instance = new IDEIntegrationRegistry();
    }
    return IDEIntegrationRegistry.instance;
  }

  /**
   * Register a new IDE integration factory
   * @param id Unique identifier for the IDE integration
   * @param factory Factory function that creates the IDE integration
   */
  register(id: string, factory: IDEIntegrationFactory): void {
    if (this.factories.has(id)) {
      throw new Error(`IDE integration with id '${id}' is already registered`);
    }
    this.factories.set(id, factory);
  }

  /**
   * Unregister an IDE integration factory
   * @param id The ID of the integration to unregister
   */
  unregister(id: string): void {
    this.factories.delete(id);
    // Also cleanup any active integration instances
    const integration = this.integrations.get(id);
    if (integration) {
      integration.cleanup().catch((error) => {
        console.warn(`Error cleaning up IDE integration '${id}':`, error);
      });
      this.integrations.delete(id);
    }
  }

  /**
   * Get all registered IDE integration IDs
   */
  getRegisteredIds(): string[] {
    return Array.from(this.factories.keys()).sort();
  }

  /**
   * Check if an IDE integration is registered
   * @param id The ID to check
   */
  isRegistered(id: string): boolean {
    return this.factories.has(id);
  }

  /**
   * Create an IDE integration instance
   * @param id The ID of the integration to create
   * @param config Configuration for the integration
   * @returns Promise that resolves to the IDE integration instance
   */
  async create(
    id: string,
    config: IDEIntegrationConfig,
  ): Promise<IDEIntegration> {
    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`No IDE integration registered with id '${id}'`);
    }

    try {
      const integration = await factory(config);
      await integration.initialize();
      this.integrations.set(id, integration);
      return integration;
    } catch (error) {
      throw new Error(
        `Failed to create IDE integration '${id}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get an existing IDE integration instance
   * @param id The ID of the integration to get
   * @returns The IDE integration instance, or undefined if not found
   */
  get(id: string): IDEIntegration | undefined {
    return this.integrations.get(id);
  }

  /**
   * Get all active IDE integration instances
   */
  getAll(): IDEIntegration[] {
    return Array.from(this.integrations.values());
  }

  /**
   * Find the first available IDE integration
   * @param config Configuration to use when testing availability
   * @returns Promise that resolves to the first available IDE integration, or null if none are available
   */
  async findAvailable(
    config: IDEIntegrationConfig,
  ): Promise<IDEIntegration | null> {
    for (const id of this.getRegisteredIds()) {
      try {
        const integration = await this.create(id, config);
        if (await integration.isAvailable()) {
          return integration;
        }
        // Clean up if not available
        await integration.cleanup();
        this.integrations.delete(id);
      } catch (error) {
        // Continue to next integration if this one fails
        console.debug(
          `IDE integration '${id}' failed availability check:`,
          error,
        );
      }
    }
    return null;
  }

  /**
   * Get all available IDE integrations
   * @param config Configuration to use when testing availability
   * @returns Promise that resolves to an array of available IDE integrations
   */
  async getAvailable(config: IDEIntegrationConfig): Promise<IDEIntegration[]> {
    const available: IDEIntegration[] = [];

    for (const id of this.getRegisteredIds()) {
      try {
        const integration = await this.create(id, config);
        if (await integration.isAvailable()) {
          available.push(integration);
        } else {
          // Clean up if not available
          await integration.cleanup();
          this.integrations.delete(id);
        }
      } catch (error) {
        // Continue to next integration if this one fails
        console.debug(
          `IDE integration '${id}' failed availability check:`,
          error,
        );
      }
    }

    return available;
  }

  /**
   * Clean up all active integrations
   */
  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.integrations.values()).map(
      (integration) =>
        integration.cleanup().catch((error) => {
          console.warn(
            `Error cleaning up IDE integration '${integration.id}':`,
            error,
          );
        }),
    );

    await Promise.all(cleanupPromises);
    this.integrations.clear();
  }
}
