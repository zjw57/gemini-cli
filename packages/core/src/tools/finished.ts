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

export type FinishedToolParams = {
  testsPass: boolean;
  workCrossChecked: boolean;
  usersRequestFulfilledEntirely: boolean;
};

class FinishedToolInvocation extends BaseToolInvocation<
  FinishedToolParams,
  ToolResult
> {
  constructor(params: FinishedToolParams) {
    super(params);
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
      'Call this tool only after you have completed all your work and are ready to end the interaction. If you have written or modified any code, you MUST run the appropriate tests and report the outcome in the `testsPass` parameter. This signals that the task is complete.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          testsPass: {
            type: 'boolean',
            description:
              'Required if any code was written or modified. Set to `true` if all tests passed. Cannot be called with false.',
          },
          workCrossChecked: {
            type: 'boolean',
            description:
              'You must think through the work you have done and set this to `true`. This is a mandatory check. Cannot be called with false.',
          },
          usersRequestFulfilledEntirely: {
            type: 'boolean',
            description:
              "Set to `true` if the user's request was fulfilled entirely. Cannot be called with false.",
          },
        },
        required: [
          'testsPass',
          'workCrossChecked',
          'usersRequestFulfilledEntirely',
        ],
      },
    );
  }

  protected createInvocation(
    params: FinishedToolParams,
  ): ToolInvocation<FinishedToolParams, ToolResult> {
    return new FinishedToolInvocation(params);
  }
}
