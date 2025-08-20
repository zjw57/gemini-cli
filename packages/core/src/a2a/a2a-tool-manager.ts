/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/a2a/a2a-tool-manager.ts

import { Config } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { A2AClientManager } from './a2a-client-manager.js';
import { A2ATool } from './a2a-tool.js';

export class A2AToolManager {
  constructor(
    private readonly config: Config,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async initialize(): Promise<void> {
    const agents = this.config.getA2AAgents();
    if (!agents) {
      return;
    }

    const clientManager = A2AClientManager.getInstance();
    for (const name in agents) {
      const agentConfig = agents[name];
      try {
        const agentCard = await clientManager.loadAgent(
          name,
          agentConfig.url,
          agentConfig.token,
        );
        if (agentCard.skills) {
          for (const skill of agentCard.skills) {
            const tool = new A2ATool(name, skill.name, skill.description);
            this.toolRegistry.registerTool(tool);
          }
        }
      } catch (e) {
        // Log the error, but don't block the CLI from starting.
        console.error(`Error loading A2A agent "${name}":`, e);
      }
    }
  }
}
