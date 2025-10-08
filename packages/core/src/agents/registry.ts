/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { AgentDefinition } from './types.js';
import { CodebaseInvestigatorAgent } from './codebase-investigator.js';
import { type z } from 'zod';

/**
 * Manages the discovery, loading, validation, and registration of
 * AgentDefinitions.
 */
export class AgentRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly agents = new Map<string, AgentDefinition<any>>();

  constructor(private readonly config: Config) {}

  /**
   * Discovers and loads agents.
   */
  async initialize(): Promise<void> {
    this.loadBuiltInAgents();

    if (this.config.getDebugMode()) {
      console.log(
        `[AgentRegistry] Initialized with ${this.agents.size} agents.`,
      );
    }
  }

  private loadBuiltInAgents(): void {
    if (this.config.getSubagents()?.['codebase_investigator']) {
      this.registerAgent(CodebaseInvestigatorAgent);
    }
  }

  /**
   * Registers an agent definition. If an agent with the same name exists,
   * it will be overwritten, respecting the precedence established by the
   * initialization order.
   */
  protected registerAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): void {
    // Basic validation
    if (!definition.name || !definition.description) {
      console.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    if (this.agents.has(definition.name) && this.config.getDebugMode()) {
      console.log(`[AgentRegistry] Overriding agent '${definition.name}'`);
    }

    const agentConfig = this.config.getSubagents()?.[definition.name];

    let finalDefinition = definition;

    if (agentConfig && typeof agentConfig === 'object') {
      const newDefinition = { ...definition };

      const modelConfig = { ...(newDefinition.modelConfig ?? {}) };
      const runConfig = { ...(newDefinition.runConfig ?? {}) };

      if (agentConfig.model) {
        modelConfig.model = agentConfig.model;
      }
      if (agentConfig.temperature) {
        modelConfig.temp = agentConfig.temperature;
      }
      if (agentConfig.thinkingBudget) {
        modelConfig.thinkingBudget = agentConfig.thinkingBudget;
      }
      if (agentConfig.maxTurns) {
        runConfig.max_turns = agentConfig.maxTurns;
      }

      newDefinition.modelConfig = modelConfig;
      newDefinition.runConfig = runConfig;
      finalDefinition = newDefinition;
    }

    this.agents.set(definition.name, finalDefinition);
  }

  /**
   * Retrieves an agent definition by name.
   */
  getDefinition(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
