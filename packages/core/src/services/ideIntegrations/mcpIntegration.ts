/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IDEIntegration,
  IDEIntegrationConfig,
  ActiveFileContext,
} from './types.js';
import { MCPTransport } from './mcpTransport.js';

/**
 * Generic MCP-based IDE integration.
 *
 * This integration is IDE-agnostic and works with any IDE that implements
 * an MCP server with the required tools and notifications. The IDE is responsible
 * for implementing the MCP protocol, not Gemini CLI for knowing about specific IDEs.
 *
 * This follows the same pattern as Language Server Protocol (LSP), Debug Adapter
 * Protocol (DAP), etc. - the protocol is the abstraction layer.
 */
export class MCPIDEIntegration implements IDEIntegration {
  private transport: MCPTransport;

  constructor(config: IDEIntegrationConfig) {
    this.transport = new MCPTransport(config);
  }

  async isAvailable(): Promise<boolean> {
    return await this.transport.isAvailable();
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    return await this.transport.getActiveFile();
  }

  async sendNotification(message: string): Promise<void> {
    return await this.transport.sendNotification(message);
  }

  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this.transport.setNotificationHandler(handler);
  }

  async initialize(): Promise<void> {
    await this.transport.initialize();
  }

  async cleanup(): Promise<void> {
    await this.transport.cleanup();
  }
}

/**
 * Factory function to create the generic MCP IDE integration
 */
export async function createMCPIDEIntegration(
  config: IDEIntegrationConfig,
): Promise<IDEIntegration> {
  return new MCPIDEIntegration(config);
}
