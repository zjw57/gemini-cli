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
 * Parameters for the CreateTests tool
 */
export interface CreateTestsToolParams {
  /**
   * The absolute path to the file to create tests for
   */
  path: string;
}

/**
 * Implementation of the CreateTests tool logic
 */
export class CreateTestsTool extends BaseTool<
  CreateTestsToolParams,
  ToolResult
> {
  static readonly Name = 'create_tests';

  /**
   * Creates a new instance of the CreateTestsTool.
   * @param rootDirectory Root directory to ground this tool in. All operations will be restricted to this directory.
   * @param config Configuration object.
   */
  constructor(
    private rootDirectory: string,
    private config: Config,
  ) {
    super(
      CreateTestsTool.Name,
      'CreateTests',
      'Given a file, create a new unit test for it.',
      {
        properties: {
          path: {
            description:
              'This is the path to the file to create a unit test for.',
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
   * Executes the create tests operation using a subagent and orchestrator.
   * @param params Parameters for the create tests operation.
   * @param _signal AbortSignal (not used).
   * @returns A ToolResult object.  Returns an error object if the operation fails.
   */
  async execute(
    params: CreateTestsToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    // Create a subagent, and invoke it with these params and give it access to the specific tools.
    const configParams: ConfigParameters = {
      sessionId: 'smarttool-createtests-session',
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
      plan: `Your job is to write unit tests for the file located at ${params.path}. You need to analyze the file, understand its functionality, and then write comprehensive unit tests to ensure it works correctly.\n\n// Step-by-Step Workflow:\n1.  **Load the File:** Use the ${ReadFileTool.Name} to load the source code from ${params.path}.\n2.  **Identify Language & Framework:** Analyze the file content and surrounding files to determine the programming language and testing framework. State the language and framework you will use (e.g., "This is a TypeScript file, and I will use Vitest for testing.").\n3.  **Determine Test File Path:** Based on project conventions, decide the correct path for the new test file (e.g., alongside the source file, in a '__tests__' directory).\n4.  **Write Tests:** Create a new file with the unit tests. The tests should cover all public functions and methods, including edge cases and error conditions.\n5.  **Run Tests:** Use the ${ShellTool.Name} to execute the newly created tests and verify that they pass. If they fail, you should try to fix them.\n\nRules for great unit tests:\n* Tests should be isolated and not depend on each other.\n* Mock any external dependencies to ensure the test is focused on the unit of code being tested.\n* Test for both expected outcomes and error conditions.\n\nImportant notes about your task:\n* You will need to create a new file for the tests.\n* Make sure the tests you write are idiomatic for the language and framework you are using.\n* Run the tests to ensure they pass before you declare your work complete.\n`,
      goals: `* Create a new unit test file for ${params.path}\n* Ensure all tests in the new file pass`,
      outputs: {
        summary:
          'A summary of the tests you created and the results of running them.',
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
          llmContent: 'Tests created and passed successfully',
          returnDisplay: 'Tests created and passed successfully',
        };
      }
    } catch (error) {
      console.error('Orchestrator run failed:', error);
    }
    return {
      llmContent: `Error: An error occurred while trying to create tests for ${params.path}`,
      returnDisplay: `Error: An error occurred while trying to create tests for ${params.path}`,
    };
  }
}
