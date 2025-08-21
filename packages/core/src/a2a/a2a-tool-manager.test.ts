/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/a2a/a2a-tool-manager.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AToolManager } from './a2a-tool-manager.js';
import { A2AAgentConfig, Config, ConfigParameters } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { AgentCard } from '@a2a-js/sdk';

vi.mock('../config/config.js');
vi.mock('../tools/tool-registry.js');

const mockLoadAgent = vi.fn();
vi.mock('./a2a-client-manager.js', () => ({
  A2AClientManager: {
    getInstance: vi.fn(() => ({
      loadAgent: mockLoadAgent,
    })),
  },
}));

describe('A2AToolManager', () => {
  let config: Config;
  let toolRegistry: ToolRegistry;
  let toolManager: A2AToolManager;

  beforeEach(() => {
    config = new Config({} as ConfigParameters);
    toolRegistry = new ToolRegistry(config);
    toolManager = new A2AToolManager(config, toolRegistry);
    vi.clearAllMocks();
  });

  it('should load agents and register tools on initialize', async () => {
    const agents: Record<string, A2AAgentConfig> = {
      TestAgent: { url: 'http://test.agent', accessToken: 'test-token' },
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
    });

    vi.spyOn(config, 'getA2AAgents').mockReturnValue(agents);
    mockLoadAgent.mockResolvedValue(agentCard);
    vi.spyOn(toolRegistry, 'registerTool');

    await toolManager.initialize();

    expect(config.getA2AAgents).toHaveBeenCalled();
    expect(mockLoadAgent).toHaveBeenCalledWith(
      'TestAgent',
      'http://test.agent',
      'test-token',
    );
    expect(toolRegistry.registerTool).toHaveBeenCalled();
  });
});

function completeAgentCard(agentCard: Partial<AgentCard>): AgentCard {
  return {
    name: 'UnassignedAgentName',
    description: 'Unassigned Agent',
    url: 'http://unassigned.agent',
    protocolVersion: '0.3.0',
    version: '1.0.0',
    capabilities: {},
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
    ...agentCard,
  };
}
