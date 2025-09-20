/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file implements the non-interactive mode for the Gemini CLI.
 * It supports experimental subagent configurations via environment variables:
 *
 * GEMINI_SUBAGENT_TOOL_NAME:
 *   Specifies the subagent tool to run.
 *   Values: 'context_harvester', 'codebase_investigator', 'planner', 'flexible_planner'
 *
 * GEMINI_SUBAGENT_INVOCATION_MODE:
 *   Determines how the subagent is invoked.
 *   - 'heuristic': The subagent runs before the main agent, and its output is
 *     prepended to the user's prompt as context. This is the default behavior.
 *   - 'agent_tool': The subagent is registered as a tool that the main agent
 *     can choose to call. The system prompt is modified to guide the agent.
 *
 * GEMINI_SUBAGENT_INCLUDE_FILE_CONTENT:
 *   If set to 'true', the content of relevant files found by the subagent
 *   will be included in its final report.
 */

import type {
  Config,
  ToolCallRequestInfo,
  ContextHarvesterInput,
  CodebaseInvestigatorInput,
  SolutionPlannerInput,
} from '@google/gemini-cli-core';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';
import {
  CodebaseInvestigatorTool,
  ContextHarvesterTool,
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  FatalInputError,
  promptIdContext,
  OutputFormat,
  JsonFormatter,
  uiTelemetryService,
  SolutionPlannerTool,
} from '@google/gemini-cli-core';

import type { Content, Part } from '@google/genai';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import {
  handleError,
  handleToolError,
  handleCancellationError,
  handleMaxTurnsExceededError,
} from './utils/errors.js';

export async function runNonInteractive(
  config: Config,
  settings: LoadedSettings,
  input: string,
  prompt_id: string,
): Promise<void> {
  return promptIdContext.run(prompt_id, async () => {
    const consolePatcher = new ConsolePatcher({
      stderr: true,
      debugMode: config.getDebugMode(),
    });

    try {
      consolePatcher.patch();
      // Handle EPIPE errors when the output is piped to a command that closes early.
      process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') {
          // Exit gracefully if the pipe is closed.
          process.exit(0);
        }
      });

      const geminiClient = config.getGeminiClient();

      const abortController = new AbortController();

      let query: Part[] | undefined;

      if (isSlashCommand(input)) {
        const slashCommandResult = await handleSlashCommand(
          input,
          abortController,
          config,
          settings,
        );
        // If a slash command is found and returns a prompt, use it.
        // Otherwise, slashCommandResult fall through to the default prompt
        // handling.
        if (slashCommandResult) {
          query = slashCommandResult as Part[];
        }
      }

      if (!query) {
        const { processedQuery, shouldProceed } = await handleAtCommand({
          query: input,
          config,
          addItem: (_item, _timestamp) => 0,
          onDebugMessage: () => {},
          messageId: Date.now(),
          signal: abortController.signal,
        });

        if (!shouldProceed || !processedQuery) {
          // An error occurred during @include processing (e.g., file not found).
          // The error message is already logged by handleAtCommand.
          throw new FatalInputError(
            'Exiting due to an error processing the @ command.',
          );
        }
        query = processedQuery as Part[];
      }

      let currentMessages: Content[] = [{ role: 'user', parts: query }];

      const subagentTestingConfig = config.getSubagentTestingConfig();

      if (subagentTestingConfig.invocationMode === 'heuristic') {
        const subAgentName = subagentTestingConfig.toolName;
        const includeFileContent = subagentTestingConfig.includeFileContent;

        if (subAgentName === 'contextHarvester') {
          const subAgentTool = new ContextHarvesterTool(config);
          const analysis_questions = [
            'Based on the user query, what is the primary goal?',
            'Identify all relevant files, functions, and classes related to the user a request.',
            'Provide a summary of the existing implementation.',
            'What is the best file to start with to implement the user a request?',
          ];
          const subAgentInput: ContextHarvesterInput = {
            user_objective: input,
            analysis_questions,
          };

          const invocation = subAgentTool.build(subAgentInput);
          const result = await invocation.execute(abortController.signal);

          if (result.llmContent) {
            (currentMessages[0].parts as Part[]).push(
              {
                text: `\n--- The user Ran the tool '${subAgentTool.name}'. The description of the tool is '${subAgentTool.description}'. 
              The questions the user asked are: '${analysis_questions}'.
              This is the result of the tool: ---\n`,
              },
              { text: result.llmContent as string },
            );
          }
        } else if (subAgentName === 'codebase_investigator') {
          const subAgentTool = new CodebaseInvestigatorTool(config);
          const subAgentInput: CodebaseInvestigatorInput = {
            user_objective: input,
            include_file_content: includeFileContent,
          };

          const invocation = subAgentTool.build(subAgentInput);
          const result = await invocation.execute(abortController.signal);

          if (result.llmContent) {
            (currentMessages[0].parts as Part[]).push(
              {
                text: `\n--- The user Ran the tool '${subAgentTool.name}'. The description of the tool is '${subAgentTool.description}' and this is the result of the tool: ---\n`,
              },
              { text: result.llmContent as string },
            );
          }
        } else if (subAgentName === 'planner') {
          const subAgentTool = new SolutionPlannerTool(config);
          const subAgentInput: SolutionPlannerInput = {
            user_objective: input,
            include_file_content: includeFileContent,
          };

          const invocation = subAgentTool.build(subAgentInput);
          const result = await invocation.execute(abortController.signal);

          if (result.llmContent) {
            (currentMessages[0].parts as Part[]).push(
              {
                text: `\n--
              The user Ran the tool '${subAgentTool.name}'. The description of the tool is '${subAgentTool.description}'.
              Follow the tool's plan. 
              **This is your most critical function. Your scratchpad is your memory and your plan.
              ** 1.  **Initialization:** On your very first turn, you **MUST** create the \`<scratchpad>\` section. **Analyze the \`step_by_step_plan\` provided by the Planner and create an initial very detailed \`Checklist\`  of steps.**  
              2.  **Constant Updates:** After **every** \`turn\`, you **MUST** update the scratchpad. * Mark checklist items as complete: \`[x]\`. * **Dynamically add new checklist items** as you uncover more complexity. 
              3. **Thinking on Paper:** The scratchpad shows your work. It must always reflect your current understanding of the codebase and what your next immediate step should be. \n\n Here is the context and plan given by the planner:  ---\n`,
              },
              { text: result.llmContent as string },
            );
          }
        } else if (subAgentName === 'flexible_planner') {
          const subAgentTool = new SolutionPlannerTool(config);
          const subAgentInput: SolutionPlannerInput = {
            user_objective: input,
            include_file_content: includeFileContent,
          };

          const invocation = subAgentTool.build(subAgentInput);
          const result = await invocation.execute(abortController.signal);

          if (result.llmContent) {
            (currentMessages[0].parts as Part[]).push(
              {
                text: `\n--
              The user Ran the tool '${subAgentTool.name}'. The description of the tool is '${subAgentTool.description}'.
              Here is the context and plan given by the planner:  ---\n`,
              },
              { text: result.llmContent as string },
            );
          }
        }
      }

      let turnCount = 0;
      while (true) {
        turnCount++;
        if (
          config.getMaxSessionTurns() >= 0 &&
          turnCount > config.getMaxSessionTurns()
        ) {
          handleMaxTurnsExceededError(config);
        }
        const toolCallRequests: ToolCallRequestInfo[] = [];

        const responseStream = geminiClient.sendMessageStream(
          currentMessages[0]?.parts || [],
          abortController.signal,
          prompt_id,
        );

        let responseText = '';
        for await (const event of responseStream) {
          if (abortController.signal.aborted) {
            handleCancellationError(config);
          }

          if (event.type === GeminiEventType.Content) {
            if (config.getOutputFormat() === OutputFormat.JSON) {
              responseText += event.value;
            } else {
              process.stdout.write(event.value);
            }
          } else if (event.type === GeminiEventType.ToolCallRequest) {
            toolCallRequests.push(event.value);
          }
        }

        if (toolCallRequests.length > 0) {
          const toolResponseParts: Part[] = [];
          for (const requestInfo of toolCallRequests) {
            const toolResponse = await executeToolCall(
              config,
              requestInfo,
              abortController.signal,
            );

            if (toolResponse.error) {
              handleToolError(
                requestInfo.name,
                toolResponse.error,
                config,
                toolResponse.errorType || 'TOOL_EXECUTION_ERROR',
                typeof toolResponse.resultDisplay === 'string'
                  ? toolResponse.resultDisplay
                  : undefined,
              );
            }

            if (toolResponse.responseParts) {
              toolResponseParts.push(...toolResponse.responseParts);
            }
          }
          currentMessages = [{ role: 'user', parts: toolResponseParts }];
        } else {
          if (config.getOutputFormat() === OutputFormat.JSON) {
            const formatter = new JsonFormatter();
            const stats = uiTelemetryService.getMetrics();
            process.stdout.write(formatter.format(responseText, stats));
          } else {
            process.stdout.write('\n'); // Ensure a final newline
          }
          return;
        }
      }
    } catch (error) {
      handleError(error, config);
    } finally {
      consolePatcher.cleanup();
      if (isTelemetrySdkInitialized()) {
        await shutdownTelemetry(config);
      }
    }
  });
}
