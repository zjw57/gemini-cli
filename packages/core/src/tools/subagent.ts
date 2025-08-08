/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { FunctionDeclaration, Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';
import { ContextState, ModelConfig, PromptConfig, SubAgentScope } from '../core/subagent.js';
import { ToolConfig, OutputConfig, RunConfig } from '../core/subagent.js';

/**
 * Parameters for the Subagent tool
 */
export interface SubagentToolParams {
  /**
   * The task for the subagent to perform.
   */
  task: string;
}

/**
 * Implementation of the subagent tool logic
 */
export class SubagentTool extends BaseTool<SubagentToolParams, ToolResult> {
  static readonly Name = 'subagent';
  private client: GeminiClient;

  constructor(private config: Config) {
    super(
      SubagentTool.Name,
      'SubAgent',
      'Delegates a task to a subagent for completion. Use this to break down complex problems.',
      Icon.Hammer,
      {
        properties: {
          task: {
            description:
              'The task for the subagent to perform. This should be a clear and specific instruction.',
            type: Type.STRING,
          },
        },
        required: ['task'],
        type: Type.OBJECT,
      },
    );
    this.client = new GeminiClient(this.config);
  }

  /**
   * Validates the parameters for the tool
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  validateToolParams(params: SubagentToolParams): string | null {
    return SchemaValidator.validate(this.schema.parameters, params);
  }



  getDescription(params: SubagentToolParams): string {
    return `Asking subagent to: ${params.task}`;
  }

  /**
   * Helper for consistent error formatting
   */
  private errorResult(llmContent: string, returnDisplay: string): ToolResult {
    return {
      llmContent: llmContent,
      returnDisplay: returnDisplay,
    };
  }

  async execute(
    params: SubagentToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    try {
        const add = {
            async function({ a, b }: { a: number; b: number }) {
                console.log(`[Tool] Adding ${a} + ${b}`);
                return a + b;
            },
        };
        
        const addTool: FunctionDeclaration = {
            name: 'add',
            description: 'Adds two numbers and returns the sum.',
            parameters: {
            type: Type.OBJECT,
            properties: {
                a: { type: Type.NUMBER, description: 'The first number.' },
                b: { type: Type.NUMBER, description: 'The second number.' },
            },
            required: ['a', 'b'],
            },
        };
        // Configure the subagent's run.
        const promptConfig: PromptConfig = {
        systemPrompt:
            'You are a helpful assistant that uses tools to solve problems. You must use the `add` tool to perform addition.',
        };

        const toolConfig: ToolConfig = {
        tools: [addTool],
        };

        const outputConfig: OutputConfig = {
        outputs: {
            final_answer:
            'The final answer to the user\'s question. Should be a number.',
        },
        };

        const modelConfig: ModelConfig = {
            model: 'gemini-2.5-pro',
            temp: 0.1,
            top_p: 0.8,
        };

        const runConfig: RunConfig = {
            max_time_minutes: 5,
            max_turns: 10,
        };

      const subagent = await SubAgentScope.create(
        'subagent',
        this.config,
        promptConfig,
        modelConfig,
        runConfig,
        toolConfig,
        outputConfig,
      );
  
      // 5. Run the agent non-interactively.
      // The agent will process the prompt, call tools if necessary,
      // and generate a final response.
      console.log('\nRunning subagent...');
      const context = new ContextState();
      const result = await subagent.runNonInteractive(context);
  
      // 6. Print the final result.
      console.log('\nSubagent finished. Result:');
      console.log(JSON.stringify(result, null, 2));

      return {
        llmContent: "Result",
        returnDisplay: 'Subagent finished.',
      };
    } catch (error) {
      const errorMsg = `Error executing subagent: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return this.errorResult(errorMsg, 'Subagent failed.');
    }
  }
}
