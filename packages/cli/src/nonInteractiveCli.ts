/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  ToolCallRequestInfo,
  ContextHarvesterInput,
  SimplifiedContextHarvesterInput,
} from '@google/gemini-cli-core';
import {
  executeToolCall,
  FatalInputError,
  FatalTurnLimitedError,
  GeminiEventType,
  isTelemetrySdkInitialized,
  parseAndFormatApiError,
  shutdownTelemetry,
} from '@google/gemini-cli-core';
import type { Content, Part } from '@google/genai';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';


export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
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

    let currentMessages: Content[] = [
      { role: 'user', parts: processedQuery as Part[] },
    ];

    const subAgentName = process.env['GEMINI_SUBAGENT_NAME'];

    if (subAgentName) {
      const toolRegistry = config.getToolRegistry();
      const contextHarvester = toolRegistry.getTool(subAgentName);

      if (subAgentName === 'contextHarvester') {
        const harvesterInput: ContextHarvesterInput = {
          user_objective: input,
          analysis_questions: [
            'Based on the user query, what is the primary goal?',
            'Identify all relevant files, functions, and classes related to the user a request.',
            'Provide a summary of the existing implementation.',
            'What is the best file to start with to implement the user a request?',
          ],
        };

        const invocation = (contextHarvester as any).build(harvesterInput);
        const result = await invocation.execute(abortController.signal);

        if (result.llmContent) {
          (currentMessages[0].parts as Part[]).push(
            { text: '\n--- Context from Context Harvester ---\n' },
            { text: result.llmContent },
          );
        }
      } else if (subAgentName === 'codebase_investigator') {
        const simplifiedHarvesterInput: SimplifiedContextHarvesterInput = {
          user_objective: input,
        };

        const invocation = (contextHarvester as any).build(simplifiedHarvesterInput);
        const result = await invocation.execute(abortController.signal);

        if (result.llmContent) {
          (currentMessages[0].parts as Part[]).push(
            { text: '\n--- Context from Codebase Investigator ---\n' },
            { text: result.llmContent },
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
        throw new FatalTurnLimitedError(
          'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
      }
      const toolCallRequests: ToolCallRequestInfo[] = [];

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          process.stdout.write(event.value);
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
            console.error(
              `Error executing tool ${requestInfo.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error(
      parseAndFormatApiError(
        error,
        config.getContentGeneratorConfig()?.authType,
      ),
    );
    throw error;
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
