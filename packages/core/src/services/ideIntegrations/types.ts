/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Represents the context of the currently active file in an IDE.
 */
export interface ActiveFileContext {
  filePath: string;
  cursor?: {
    line: number;
    character: number;
  };
}

/**
 * Interface for IDE integrations that connect to various IDEs via different protocols.
 * Each IDE integration should implement this interface to provide a consistent API
 * for IDE-specific functionality.
 */
export interface IDEIntegration {
  /**
   * Unique identifier for this IDE integration (e.g., 'vscode', 'intellij', 'vim')
   */
  readonly id: string;

  /**
   * Human-readable name for this IDE integration
   */
  readonly name: string;

  /**
   * Description of what this integration provides
   */
  readonly description: string;

  /**
   * Check if this IDE integration is currently available/active
   * @returns Promise that resolves to true if the IDE is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the currently active file context from the IDE
   * @returns Promise that resolves to the active file context, or null if no file is active
   */
  getActiveFileContext(): Promise<ActiveFileContext | null>;

  /**
   * Send a notification to the IDE (if supported)
   * @param message The message to send to the IDE
   * @returns Promise that resolves when the notification is sent
   */
  sendNotification(message: string): Promise<void>;

  /**
   * Initialize the IDE integration (establish connection, set up listeners, etc.)
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources and close connections
   * @returns Promise that resolves when cleanup is complete
   */
  cleanup(): Promise<void>;
}

/**
 * Configuration for creating an IDE integration
 */
export interface IDEIntegrationConfig {
  /**
   * Environment variables that might be needed for the integration
   */
  environment: Record<string, string | undefined>;

  /**
   * Optional timeout for operations (in milliseconds)
   */
  timeout?: number;

  /**
   * Whether debug mode is enabled
   */
  debug?: boolean;
}

/**
 * Factory function type for creating IDE integrations
 */
export type IDEIntegrationFactory = (
  config: IDEIntegrationConfig,
) => Promise<IDEIntegration>;
