/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { Config } from '../config/config.js';
import { SubAgentScope, SubagentTerminateMode } from '../core/subagent.js';
import { Type } from '@google/genai';

/**
 * Parameters for the RunSubAgent tool
 */
export interface RunSubAgentToolParams {
  /**
   * The prompt to send to the sub-agent.
   */
  prompt: string;

  /**
   * A list of tool names to make available to the sub-agent.
   */
  tool_names: string[];

  /**
   * A dictionary of desired outputs from the sub-agent.
   */
  desired_outputs: Record<string, string>;
}

/**
 * Implementation of the RunSubAgent tool logic
 */
export class RunSubAgentTool extends BaseTool<
  RunSubAgentToolParams,
  ToolResult
> {
  static readonly Name = 'run_sub_agent';

  /**
   * Creates a new instance of the RunSubAgentTool.
   * @param config Configuration object.
   */
  constructor(private config: Config) {
    super(
      RunSubAgentTool.Name,
      'RunSubAgent',
      'Runs a sub-agent with a specific prompt and a limited set of tools.',
      {
        properties: {
          prompt: {
            description: 'The prompt to send to the sub-agent.',
            type: Type.STRING,
          },
          tool_names: {
            description:
              'A list of tool names to make available to the sub-agent.',
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
          desired_outputs: {
            description: 'A dictionary of desired outputs from the sub-agent.',
            type: Type.OBJECT,
          },
        },
        required: ['prompt', 'tool_names', 'desired_outputs'],
        type: Type.OBJECT,
      },
    );
  }

  /**
   * Executes the sub-agent.
   * @param params Parameters for the sub-agent.
   * @param _signal AbortSignal (not used).
   * @returns A ToolResult object. Returns an error object if the operation fails.
   */
  async execute(
    params: RunSubAgentToolParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const subAgentConfig = this.config;
    const originalModel = subAgentConfig.getModel();

    try {
      const promptConfig = {
        plan: params.prompt,
        goals: '',
        outputs: params.desired_outputs,
        tools: params.tool_names,
      };

      const modelConfig = {
        model: originalModel,
        temp: 0.2,
        top_p: 0.95,
      };

      const runConfig = {
        max_time_minutes: 2,
      };

      const subagentContext: Record<string, unknown> = {};

      const orchestrator = new SubAgentScope(
        subAgentConfig,
        promptConfig,
        modelConfig,
        runConfig,
      );

      await orchestrator.run(subagentContext);

      if (orchestrator.output.terminate_reason === SubagentTerminateMode.GOAL) {
        return {
          llmContent: 'Sub-agent finished successfully.',
          returnDisplay: JSON.stringify(
            orchestrator.output.emitted_vars,
            null,
            2,
          ),
        };
      } else {
        return {
          llmContent: `Sub-agent failed to complete its goal. Termination reason: ${orchestrator.output.terminate_reason}`,
          returnDisplay: `Sub-agent failed to complete its goal. Termination reason: ${orchestrator.output.terminate_reason}`,
        };
      }
    } catch (error) {
      console.error('Orchestrator run failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error: An error occurred while trying to run the sub-agent: ${errorMessage}`,
        returnDisplay: `Error: An error occurred while trying to run the sub-agent: ${errorMessage}`,
      };
    } finally {
      // Restore the original model on the config object.
      subAgentConfig.setModel(originalModel);
    }
  }
}
