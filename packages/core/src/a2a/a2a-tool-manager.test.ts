/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/a2a/a2a-tool-manager.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AToolManager } from './a2a-tool-manager.js';
import { Config, ConfigParameters } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { A2AClientManager } from './a2a-client-manager.js';
import { A2AAgentConfig } from './types.js';
import { AgentCard } from '@a2a-js/sdk';

vi.mock('../config/config.js');
vi.mock('../tools/tool-registry.js');
vi.mock('./a2a-client-manager.js');

describe('A2AToolManager', () => {
  let config: Config;
  let toolRegistry: ToolRegistry;
  let clientManager: A2AClientManager;
  let toolManager: A2AToolManager;

  beforeEach(() => {
    config = new Config({} as ConfigParameters);
    toolRegistry = new ToolRegistry(config);
    clientManager = A2AClientManager.getInstance();
    toolManager = new A2AToolManager(config, toolRegistry);
  });

  it('should load agents and register tools on initialize', async () => {
    const agents: Record<string, A2AAgentConfig> = {
      TestAgent: { url: 'http://test.agent' },
    };
    const agentCard: AgentCard = completeAgentCard({
      name: 'TestAgent',
      description: 'A test agent',
      url: 'http://test.agent',
      skills: [
        {
          name: 'testSkill',
          description: 'A test skill',
          id: 'test-id',
          tags: ['test-tag'],
        },
      ],
    } as Partial<AgentCard>);

    vi.spyOn(config, 'getA2AAgents').mockReturnValue(agents);
    vi.spyOn(clientManager, 'loadAgent').mockResolvedValue(agentCard);
    vi.spyOn(toolRegistry, 'registerTool');

    await toolManager.initialize();

    expect(config.getA2AAgents).toHaveBeenCalled();
    expect(clientManager.loadAgent).toHaveBeenCalledWith(
      'TestAgent',
      'http://test.agent',
      undefined,
    );
    expect(toolRegistry.registerTool).toHaveBeenCalled();
  });
});

function completeAgentCard(agentCard: Partial<AgentCard>): AgentCard {
  return Object.assign({
    protocolVersion: '0.3.0',
    version: '1.0.0',
    capabilities: {},
    defaultInputModes: [],
    defaultOutputModes: [],
  });
}
