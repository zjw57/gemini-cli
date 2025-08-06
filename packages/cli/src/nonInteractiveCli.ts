/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  executeToolCall,
  ToolRegistry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  ToolErrorType,
} from '@google/gemini-cli-core';
import { Content, Part, FunctionCall } from '@google/genai';

import { parseAndFormatApiError } from './ui/utils/errorParsing.js';

function logToolCallResult(
  config: Config,
  requestInfo: ToolCallRequestInfo,
  toolResponse: ToolCallResponseInfo,
) {
  const status = toolResponse.error ? 'ERROR' : 'OK';
  if (toolResponse.error) {
    process.stdout.write(
      `\nTool call status:❌ ${status} ${requestInfo.name} => ${toolResponse.error.message}\n`,
    );
  } else {
    if (toolResponse.resultDisplay) {
      process.stdout.write(
        `\nTool call status:✅ ${status} ${requestInfo.name} => ${toolResponse.resultDisplay}\n`,
      );
    } else {
      process.stdout.write(`\nTool call status:✅ ${status} ${requestInfo.name}\n`);
    }
  }
}

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  await config.initialize();
  // Handle EPIPE errors when the output is piped to a command that closes early.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      // Exit gracefully if the pipe is closed.
      process.exit(0);
    }
  });

  const geminiClient = config.getGeminiClient();
  const toolRegistry: ToolRegistry = await config.getToolRegistry();

  const abortController = new AbortController();
  let currentMessages: Content[] = [{ role: 'user', parts: [{ text: input }] }];
  process.stdout.write(`User 🖥️: ${input}\n`);
  let turnCount = 0;
  try {
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        console.error(
          '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
        return;
      }
      const functionCalls: FunctionCall[] = [];

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );

      let thoughts = '';
      let response = '';
      const toolCalls = [];
      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          response += event.value;
        } else if (event.type === GeminiEventType.Thought) {
          thoughts += event.value.description;
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          const toolCallRequest = event.value;
          const fc: FunctionCall = {
            name: toolCallRequest.name,
            args: toolCallRequest.args,
            id: toolCallRequest.callId,
          };
          functionCalls.push(fc);
          toolCalls.push(toolCallRequest);
        }
      }
      if (thoughts) {
        process.stdout.write(`\nThought 💭: ${thoughts}\n`);
      }
      if (response) {
        process.stdout.write(`\nGemini 🤖: ${response}\n`);
      }
      for (const toolCall of toolCalls) {
        process.stdout.write(
          `\nTool call request:🔨 [${toolCall.name}] => ${JSON.stringify(toolCall.args)}\n`,
        );
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id,
          };

          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            toolRegistry,
            abortController.signal,
          );

          logToolCallResult(config, requestInfo, toolResponse);

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
            if (toolResponse.errorType === ToolErrorType.UNHANDLED_EXCEPTION)
              process.exit(1);
          }

          if (toolResponse.responseParts) {
            const parts = Array.isArray(toolResponse.responseParts)
              ? toolResponse.responseParts
              : [toolResponse.responseParts];
            for (const part of parts) {
              if (typeof part === 'string') {
                toolResponseParts.push({ text: part });
              } else if (part) {
                toolResponseParts.push(part);
              }
            }
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
    process.exit(1);
  } finally {
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry();
    }
  }
}
