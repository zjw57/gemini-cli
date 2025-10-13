/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BasePlugin, type BaseTool, type ToolContext } from '@google/adk';
import { isAdkToolAdapter, type AnyDeclarativeTool } from '../index.js';
import { randomUUID } from 'node:crypto';
import type { MessageBus } from './message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from './types.js';

export class MessageBusPlugin extends BasePlugin {
  constructor(private readonly messageBus: MessageBus) {
    super('message-bus-plugin');
  }

  override async beforeToolCallback({
    tool,
    toolArgs,
  }: {
    tool: BaseTool;
    toolArgs: { [key: string]: unknown };
    toolContext: ToolContext;
  }): Promise<{ [key: string]: unknown } | undefined> {
    let declarativeTool: AnyDeclarativeTool;
    if (isAdkToolAdapter(tool)) {
      declarativeTool = tool.tool;
    } else {
      // This shouldn't happen; the wrong type of tool was passed in.
      throw new Error('Invalid tool type passed: ' + tool);
    }
    const invocation = declarativeTool.build(toolArgs);
    const details = await invocation.shouldConfirmExecute(
      new AbortController().signal,
    );
    if (!details) {
      return Promise.resolve(undefined);
    }

    const correlationId = randomUUID();
    const toolCall = {
      name: tool.name,
      args: toolArgs,
    };

    return new Promise((resolve, reject) => {
      const responseHandler = (response: ToolConfirmationResponse) => {
        if (response.correlationId === correlationId) {
          this.messageBus.unsubscribe(
            MessageBusType.TOOL_CONFIRMATION_RESPONSE,
            responseHandler,
          );
          if (response.confirmed) {
            resolve(undefined); // Proceed with tool call
          } else {
            // This will be caught by the runner and returned as a tool error
            reject(new Error('Tool execution was denied.'));
          }
        }
      };

      this.messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        responseHandler,
      );

      const request: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall,
        correlationId,
        details,
      };

      try {
        this.messageBus.publish(request);
      } catch (_error) {
        this.messageBus.unsubscribe(
          MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          responseHandler,
        );
        // If publishing fails, proceed with the tool call
        resolve(undefined);
      }
    });
  }
}
