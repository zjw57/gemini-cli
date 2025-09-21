/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { ToolResult } from './tools.js';
import type { Config } from '../config/config.js';
import { getResponseText } from '../utils/partUtils.js';

interface ReviewerParams {
  task_description: string;
}

class ReviewerToolInvocation extends BaseToolInvocation<
  ReviewerParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ReviewerParams,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Reviewing the work done for task: ${this.params.task_description}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const reviewPrompt = `Regarding the task I asked for your help with: "${this.params.task_description}"

Please review the work you have done so far. I'd like you to critique your own progress based on our conversation and your actions.

- Alignment: How well do your actions align with my request?
- Quality Checks: Are there any quality checks (e.g., building, linting, testing) that you think you should perform?
- Code Quality: For any code you've written, what standards have you followed?
- Completeness: How close are you to completing the task? What are the remaining steps?

Please provide a concise analysis. If you believe the task is complete, let me know.`;

    const geminiClient = this.config.getGeminiClient();
    const model = this.config.getModel();
    const currentHistory = geminiClient.getChat().getHistory(true);
    const result = await geminiClient.generateContent(
      [...currentHistory, { role: 'user', parts: [{ text: reviewPrompt }] }],
      {},
      signal,
      model,
    );

    const responseText = getResponseText(result) || '';

    return {
      llmContent: responseText,
      returnDisplay: responseText,
    };
  }
}

export class ReviewerTool extends BaseDeclarativeTool<
  ReviewerParams,
  ToolResult
> {
  static readonly Name = 'review';
  constructor(private readonly config: Config) {
    super(
      ReviewerTool.Name,
      'Review',
      "Analyzes the conversation and work done so far to provide a critique and suggest next steps for ensuring quality. It checks if the work aligns with the user's task, if quality checks like building and testing have been considered, and if the overall approach is sound.",
      Kind.Think,
      {
        type: 'object',
        properties: {
          task_description: {
            type: 'string',
            description:
              "A summary of the user's request or goal that the agent has been working on.",
          },
        },
        required: ['task_description'],
      },
    );
  }

  protected createInvocation(params: ReviewerParams): ReviewerToolInvocation {
    return new ReviewerToolInvocation(this.config, params);
  }
}
