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
 * Generic IDE integration that communicates via MCP (Model Context Protocol).
 * Any IDE can integrate with Gemini CLI by running an MCP server that implements
 * the required tools and notifications.
 *
 * This design follows the same pattern as LSP, DAP, etc. - the protocol is the
 * abstraction layer, not IDE-specific implementations.
 */
export interface IDEIntegration {
  /**
   * Check if an MCP-compatible IDE is available and connected
   * @returns Promise that resolves to true if an IDE MCP server is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the currently active file context from the connected IDE via MCP
   * @returns Promise that resolves to the active file context, or null if no file is active
   */
  getActiveFileContext(): Promise<ActiveFileContext | null>;

  /**
   * Send a notification to the connected IDE via MCP (if supported by the IDE)
   * @param message The message to send to the IDE
   * @returns Promise that resolves when the notification is sent
   */
  sendNotification(message: string): Promise<void>;

  /**
   * Set up a handler for active file change notifications from the IDE
   * @param handler Callback function to handle file context changes
   */
  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void;

  /**
   * Initialize the MCP connection to detect and connect to any available IDE
   * @returns Promise that resolves when MCP connection is established
   */
  initialize(): Promise<void>;

  /**
   * Clean up the MCP connection and resources
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
 * Factory function for creating the generic MCP-based IDE integration
 */
export type IDEIntegrationFactory = (
  config: IDEIntegrationConfig,
) => Promise<IDEIntegration>;
