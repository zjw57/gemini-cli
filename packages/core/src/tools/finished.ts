/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  type ToolInvocation,
  type ToolResult,
  Kind,
  BaseToolInvocation,
} from './tools.js';

export type FinishedToolParams = Record<string, never>;

class FinishedToolInvocation extends BaseToolInvocation<
  FinishedToolParams,
  ToolResult
> {
  constructor() {
    super({});
  }

  getDescription(): string {
    return 'Finished';
  }

  async execute(
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // No-op
    return {
      llmContent: 'Finished',
      returnDisplay: 'Finished',
    };
  }
}

export class FinishedTool extends BaseDeclarativeTool<
  FinishedToolParams,
  ToolResult
> {
  static readonly Name = 'finished';

  constructor() {
    super(
      FinishedTool.Name,
      'Finished',
      'Call this tool only after you have completed all your work, verified it with tests, linting, or other quality checks, and are ready to end the interaction. This signals that the task is complete.',
      Kind.Other,
      {
        type: 'object',
        properties: {},
        required: [],
      },
    );
  }

  protected createInvocation(
    _params: FinishedToolParams,
  ): ToolInvocation<FinishedToolParams, ToolResult> {
    return new FinishedToolInvocation();
  }
}
