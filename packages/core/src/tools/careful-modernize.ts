/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { BaseTool, ToolResult } from './tools.js';
import { Config, ConfigParameters } from '../config/config.js';
import {
  SubAgentScope,
  SubagentTerminateMode,
  ContextState,
} from '../core/subagent.js';
import { LSTool } from './ls.js';
import { GrepTool } from './grep.js';
import { EditTool } from './edit.js';
import { ReadFileTool } from './read-file.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { ShellTool } from './shell.js';

/**
 * Parameters for the CarefulModernizeTool
 */
export interface CarefulModernizeToolParams {
  /**
   * The absolute path to the file to modernize
   */
  path: string;
}

/**
 * Implementation of the CarefulModernizeTool logic
 */
export class CarefulModernizeTool extends BaseTool<
  CarefulModernizeToolParams,
  ToolResult
> {
  static readonly Name = 'careful_modernize';

  /**
   * Creates a new instance of the CarefulModernizeTool.
   * @param rootDirectory Root directory to ground this tool in. All operations will be restricted to this directory.
   * @param config Configuration object.
   */
  constructor(
    private rootDirectory: string,
    private config: Config,
  ) {
    super(
      CarefulModernizeTool.Name,
      'CarefulModernize',
      'Given a file, review the code and update it to the modern standards for the language.',
      {
        properties: {
          path: {
            description:
              'This is the path to the file to modernize the code in.',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      },
    );

    // Set the root directory
    this.rootDirectory = path.resolve(rootDirectory);
  }

  /**
   * Executes the careful modernize operation using a subagent and orchestrator.
   * @param params Parameters for the careful modernize operation.
   * @param _signal AbortSignal (not used).
   * @returns A ToolResult object. Returns an error object if the operation fails.
   */
  async execute(
    params: CarefulModernizeToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    // Create a subagent, and invoke it with these params and give it access to the specific tools.
    const configParams: ConfigParameters = {
      sessionId: 'smarttool-carefulmodernize-session',
      targetDir: '.',
      debugMode: false,
      cwd: process.cwd(),
      model: DEFAULT_GEMINI_FLASH_MODEL,
    };

    const subAgentConfig = new Config(configParams);
    const contentGeneratorConfig = this.config.getContentGeneratorConfig();
    if (!contentGeneratorConfig?.authType) {
      return {
        llmContent:
          'Error: Parent tool is not properly authenticated. Cannot create sub-agent.',
        returnDisplay:
          'Error: Parent tool is not properly authenticated. Cannot create sub-agent.',
      };
    }
    await subAgentConfig.refreshAuth(contentGeneratorConfig.authType);

    const promptConfig = {
      plan: `Your job is to read the file located at ${params.path} and edit it to make sure that it is updated to modern standards for its language. For example, if you see a for-loop, you should see if it can be converted to a more modern iterator.

// Step-by-Step Workflow:
1.  **Load the File:** Use the ${ReadFileTool.Name} to load the source code from ${params.path}.
2.  **Identify Language & Conventions:** Analyze the file content or extension to determine the programming language. State the language and the modern conventions you will use (e.g., "This is a Python file. I will use list comprehensions instead of for-loops where applicable.").
3.  **Locate Outdated Patterns:** Systematically scan the code and create a list of code patterns that can be modernized.
4.  **Analyze and Edit (One Pattern at a Time):** For each pattern in your list, perform the following micro-workflow:
    a. **Analyze Safety:** Evaluate if the modernization can be done without changing the logic.
    b. **Execute Edit:** If an update can be made safely, formulate a precise edit to replace the outdated pattern. Do not modify any other part of the file.
5.  **Run Tests (If Available):** If there are tests for the file, run them using the ${ShellTool.Name} to ensure your changes have not broken anything.

Important notes about your task:
* Do not try to edit the whole file at once. Make small, incremental edits.
* Be careful not to edit any part of the file that would cause errors.
* Your job is to JUST modernize the code - Do not change any other logic or comments.
`,
      goals: `* Modernize the code in ${params.path} to current language standards.`,
      outputs: {
        summary: 'A summary of the modernizations you made to the target file.',
      },
      tools: [
        ReadFileTool.Name,
        EditTool.Name,
        LSTool.Name,
        GrepTool.Name,
        ShellTool.Name,
      ],
    };

    const modelConfig = {
      model: DEFAULT_GEMINI_FLASH_MODEL,
      temp: 0.2,
      top_p: 0.95,
    };

    const runConfig = {
      max_time_minutes: 5,
    };

    const context = new ContextState();

    const orchestrator = new SubAgentScope(
      subAgentConfig,
      promptConfig,
      modelConfig,
      runConfig,
    );

    try {
      await orchestrator.runNonInteractive(context);

      if (orchestrator.output.terminate_reason === SubagentTerminateMode.GOAL) {
        return {
          llmContent: 'Code modernized successfully',
          returnDisplay: 'Code modernized successfully',
        };
      }
    } catch (error) {
      console.error('Orchestrator run failed:', error);
    }
    return {
      llmContent: `Error: An error occurred while trying to modernize code for ${params.path}`,
      returnDisplay: `Error: An error occurred while trying to modernize code for ${params.path}`,
    };
  }
}
