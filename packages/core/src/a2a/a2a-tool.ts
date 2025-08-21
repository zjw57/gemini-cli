/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/a2a/a2a-tool.ts

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolResult,
} from '../tools/tools.js';
import { A2AClientManager } from './a2a-client-manager.js';

class A2AToolInvocation extends BaseToolInvocation<
  { message: string },
  ToolResult
> {
  constructor(
    private readonly agentName: string,
    private readonly skillName: string,
    params: { message: string },
  ) {
    super(params);
  }

  getDescription(): string {
    return `Calling skill ${this.skillName} on agent ${this.agentName} with message: ${this.params.message}`;
  }

  async execute(): Promise<ToolResult> {
    const clientManager = A2AClientManager.getInstance();
    const response = await clientManager.sendMessage(
      this.agentName,
      this.params.message,
    );
    // TODO: process the response and extract the relevant information
    return {
      llmContent: JSON.stringify(response),
      returnDisplay: JSON.stringify(response, null, 2),
    };
  }
}

export class A2ATool extends BaseDeclarativeTool<
  { message: string },
  ToolResult
> {
  constructor(
    private readonly agentName: string,
    private readonly skillName: string,
    description: string,
  ) {
    super(
      `${agentName}_${skillName}`,
      `${agentName}: ${skillName}`,
      description,
      Kind.Other, // Using Kind.Other as requested
      {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to send to the agent skill.',
          },
        },
        required: ['message'],
      },
    );
  }

  protected createInvocation(params: {
    message: string;
  }): BaseToolInvocation<{ message: string }, ToolResult> {
    return new A2AToolInvocation(this.agentName, this.skillName, params);
  }
}
