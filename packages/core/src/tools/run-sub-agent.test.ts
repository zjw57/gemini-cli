/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { RunSubAgentTool, RunSubAgentToolParams } from './run-sub-agent.js';
import { Config } from '../config/config.js';
import {
  SubAgentScope,
  SubagentTerminateMode,
  PromptConfig,
  ModelConfig,
  RunConfig,
} from '../core/subagent.js';

// Mock the SubAgentScope class
vi.mock('../core/subagent.js', async () => {
  const actual = await vi.importActual('../core/subagent.js');
  const SubAgentScope = vi.fn();
  SubAgentScope.prototype.run = vi.fn();
  return {
    ...actual,
    SubAgentScope,
  };
});

describe('RunSubAgentTool', () => {
  let tool: RunSubAgentTool;
  let mockConfig: Config;
  let mockSubAgentScopeInstance: SubAgentScope;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    mockConfig = {
      getGeminiClient: vi.fn(),
      getModel: () => 'test-model',
      setModel: vi.fn(),
    } as unknown as Config;

    tool = new RunSubAgentTool(mockConfig);

    // Create a fresh mock instance for each test
    mockSubAgentScopeInstance = new SubAgentScope(
      {} as Config,
      {} as PromptConfig,
      {} as ModelConfig,
      {} as RunConfig,
    );
  });

  it('should instantiate correctly', () => {
    expect(tool).toBeInstanceOf(RunSubAgentTool);
    expect(tool.name).toBe('run_sub_agent');
  });

  it('should execute the sub-agent and return success', async () => {
    const params: RunSubAgentToolParams = {
      prompt: 'Test prompt',
      tool_names: ['test_tool'],
      desired_outputs: { summary: 'A summary' },
    };

    // Configure the mock for this specific test
    (mockSubAgentScopeInstance.run as Mock).mockResolvedValue(undefined);
    mockSubAgentScopeInstance.output = {
      terminate_reason: SubagentTerminateMode.GOAL,
      emitted_vars: { summary: 'It worked!' },
    };
    (SubAgentScope as unknown as Mock).mockImplementation(
      () => mockSubAgentScopeInstance,
    );

    const result = await tool.execute(params, new AbortController().signal);

    expect(SubAgentScope).toHaveBeenCalledWith(
      mockConfig,
      {
        plan: 'Test prompt',
        goals: '',
        outputs: { summary: 'A summary' },
        tools: ['test_tool'],
      },
      {
        model: 'test-model',
        temp: 0.2,
        top_p: 0.95,
      },
      {
        max_time_minutes: 2,
      },
    );
    expect(mockSubAgentScopeInstance.run).toHaveBeenCalled();
    expect(result.llmContent).toBe('Sub-agent finished successfully.');
    expect(result.returnDisplay).toContain('It worked!');
  });

  it('should handle sub-agent failure', async () => {
    const params: RunSubAgentToolParams = {
      prompt: 'Test prompt',
      tool_names: ['test_tool'],
      desired_outputs: { summary: 'A summary' },
    };

    // Configure the mock for this specific test
    (mockSubAgentScopeInstance.run as Mock).mockResolvedValue(undefined);
    mockSubAgentScopeInstance.output = {
      terminate_reason: SubagentTerminateMode.ERROR,
      emitted_vars: {},
    };
    (SubAgentScope as unknown as Mock).mockImplementation(
      () => mockSubAgentScopeInstance,
    );

    const result = await tool.execute(params, new AbortController().signal);

    expect(result.llmContent).toContain(
      'Sub-agent failed to complete its goal.',
    );
  });

  it('should handle exceptions during sub-agent execution', async () => {
    const params: RunSubAgentToolParams = {
      prompt: 'Test prompt',
      tool_names: ['test_tool'],
      desired_outputs: { summary: 'A summary' },
    };

    // Configure the mock for this specific test
    (mockSubAgentScopeInstance.run as Mock).mockRejectedValue(
      new Error('Something went wrong'),
    );
    (SubAgentScope as unknown as Mock).mockImplementation(
      () => mockSubAgentScopeInstance,
    );

    const result = await tool.execute(params, new AbortController().signal);

    expect(result.llmContent).toContain(
      'Error: An error occurred while trying to run the sub-agent: Something went wrong',
    );
  });
});
