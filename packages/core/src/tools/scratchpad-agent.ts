/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { Config } from '../config/config.js';
import { SubAgentScope, SubagentTerminateMode } from '../core/subagent.js';
import { ReadFileTool } from './read-file.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import {
  FunctionDeclaration,
  Type,
  FunctionCall,
  Content,
} from '@google/genai';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { LSTool } from './ls.js';
import { ReadManyFilesTool } from './read-many-files.js';
import { WebFetchTool } from './web-fetch.js';
import { WebSearchTool } from './web-search.js';
import { FileSnippet } from '../core/scratchpad.js';
import { ToolRegistry } from './tool-registry.js';

export interface ScratchpadAgentParams {
  query: string;
  clearScratchpad?: boolean;
}

/**
 * A tool that uses a sub-agent to populate the scratchpad with relevant information.
 */
export class ScratchpadAgentTool extends BaseTool<
  ScratchpadAgentParams,
  ToolResult
> {
  static readonly Name = 'scratchpad_agent';

  constructor(private config: Config) {
    super(
      ScratchpadAgentTool.Name,
      'ScratchpadAgent',
      'This tool is extreamly important to collect data which is relevant to your focus in the codebase. This tool will collect and save relevant information into a scratchpad that will make your file editing more accurate!',
      {
        properties: {
          query: {
            type: Type.STRING,
            description:
              'The query to use to populate the scratchpad with information.',
          },
          clearScratchpad: {
            type: Type.BOOLEAN,
            description:
              'If true, the scratchpad will be cleared before new information is added.',
          },
        },
        required: ['query'],
        type: Type.OBJECT,
      },
    );
  }

  async execute(
    params: ScratchpadAgentParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    if (params.clearScratchpad) {
      this.config.scratchpad.clearSnippets();
    }
    const originalModel = this.config.getModel();

    const emitValueTool: FunctionDeclaration = {
      name: 'self.save_to_scratchpad',
      description: `* This tool saves A SINGLE value to the scratch pad, such that it can be collected and presented to the calling function.
            * You can only save ONE VALUE each time you call this tool. You are expected to call this tool MULTIPLE TIMES if you have MULTIPLE OUTPUTS.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          save_variable_name: {
            description:
              'This is the name of the variable to be save dto the scratchpad.',
            type: Type.STRING,
          },
          save_variable_value: {
            description: 'This is the _value_ to be saved.',
            type: Type.STRING,
          },
        },
        required: ['save_variable_name', 'save_variable_value'],
      },
    };

    try {
      const subAgentConfig = this.config;
      const promptConfig = {
        plan: `Your job is to populate the scratch pad based on the following query: ${params.query}. You want to use the tools you have available and gather relevant data. For code, this might mean code snippets from the repo, or web search items.`,
        goals: '* Populate the scratchpad with relevant information.',
        outputs: {
          summary: 'A summary of the information added to the scratchpad.',
        },
        tools: [
          GlobTool.Name,
          GrepTool.Name,
          LSTool.Name,
          ReadFileTool.Name,
          ReadManyFilesTool.Name,
          WebFetchTool.Name,
          WebSearchTool.Name,
          emitValueTool,
        ],
      };

      const modelConfig = {
        model: DEFAULT_GEMINI_FLASH_MODEL,
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

      const originalProcessFunctionCalls = (
        orchestrator as SubAgentScope
      ).processFunctionCalls.bind(orchestrator);

      (orchestrator as any).processFunctionCalls = async (
        functionCalls: FunctionCall[],
        toolRegistry: ToolRegistry,
        abortController: AbortController,
        currentMessages: Content[],
        runNonInteractive: boolean,
      ): Promise<Content[]> => {
        const unhandledFunctionCalls = [];
        for (const funcCall of functionCalls) {
          if (funcCall.name === 'self.save_to_scratchpad') {
            const args = funcCall.args as {
              save_variable_name: string;
              save_variable_value: string;
            };

            this.config.scratchpad.addSnippet(
              new FileSnippet(
                args.save_variable_name,
                0,
                0,
                args.save_variable_value,
              ),
            );
          } else {
            unhandledFunctionCalls.push(funcCall);
          }
        }

        if (unhandledFunctionCalls.length === 0) {
          return Promise.resolve([{ role: 'user', parts: [{ text: 'OK' }] }]);
        }

        return await originalProcessFunctionCalls(
          unhandledFunctionCalls,
          toolRegistry,
          abortController,
          currentMessages,
          runNonInteractive,
        );
      };

      await orchestrator.run(subagentContext, true);

      if (orchestrator.output.terminate_reason === SubagentTerminateMode.GOAL) {
        return {
          llmContent: 'Scratchpad populated successfully.',
          returnDisplay: 'Scratchpad populated successfully.',
        };
      }
    } catch (error) {
      console.error('Orchestrator run failed:', error);
    } finally {
      this.config.setModel(originalModel);
    }
    return {
      llmContent: `Error: An error occurred while trying to populate the scratchpad.`,
      returnDisplay: `Error: An error occurred while trying to populate the scratchpad.`,
    };
  }
}
