/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ModifiableDeclarativeTool,
  ModifyContext,
} from '../tools/modifiable-tool.js';
import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolResult,
} from '../tools/tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
} from '../tools/tools.js';

export const MOCK_TOOL_SHOULD_CONFIRM_EXECUTE = () =>
  Promise.resolve({
    type: 'exec' as const,
    title: 'Confirm mockTool',
    command: 'mockTool',
    rootCommand: 'mockTool',
    onConfirm: async () => {},
  });

export const MODIFIABLE_MOCK_TOOL_SHOULD_CONFIRM_EXECUTE_PARAMS: MockModifiableToolShouldConfirmExecuteParams =
  {
    filePath: 'test.txt',
    currentContent: 'old content',
    proposedContent: 'new content',
  };

interface MockToolOptions {
  name: string;
  displayName?: string;
  description?: string;
  canUpdateOutput?: boolean;
  isOutputMarkdown?: boolean;
  shouldConfirmExecute?: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
  ) => Promise<ToolCallConfirmationDetails | false>;
  execute?: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ) => Promise<ToolResult>;
  params?: object;
}

interface MockModifiableToolShouldConfirmExecuteParams {
  filePath: string;
  currentContent: string;
  proposedContent: string;
}

interface MockModifiableToolOptions extends Partial<MockToolOptions> {
  shouldConfirmExecuteParams?: MockModifiableToolShouldConfirmExecuteParams;
  createUpdatedParams?: (
    oldContent: string,
    modifiedProposedContent: string,
    originalParams: Record<string, unknown>,
  ) => Record<string, unknown>;
}

class MockToolInvocation extends BaseToolInvocation<
  { [key: string]: unknown },
  ToolResult
> {
  constructor(
    private readonly tool: MockTool,
    params: { [key: string]: unknown },
  ) {
    super(params);
  }

  execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    return this.tool.execute(this.params, signal, updateOutput);
  }

  override shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return this.tool.shouldConfirmExecute(this.params, abortSignal);
  }

  getDescription(): string {
    return `A mock tool invocation for ${this.tool.name}`;
  }
}

/**
 * A highly configurable mock tool for testing purposes.
 */
export class MockTool extends BaseDeclarativeTool<
  { [key: string]: unknown },
  ToolResult
> {
  shouldConfirmExecute: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
  ) => Promise<ToolCallConfirmationDetails | false>;
  execute: (
    params: { [key: string]: unknown },
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ) => Promise<ToolResult>;

  constructor(options: MockToolOptions) {
    super(
      options.name,
      options.displayName ?? options.name,
      options.description ?? options.name,
      Kind.Other,
      options.params,
      options.isOutputMarkdown ?? false,
      options.canUpdateOutput ?? false,
    );

    if (options.shouldConfirmExecute) {
      this.shouldConfirmExecute = options.shouldConfirmExecute;
    } else {
      this.shouldConfirmExecute = () => Promise.resolve(false);
    }

    if (options.execute) {
      this.execute = options.execute;
    } else {
      this.execute = () =>
        Promise.resolve({
          llmContent: `Tool ${this.name} executed successfully.`,
          returnDisplay: `Tool ${this.name} executed successfully.`,
        });
    }
  }

  protected createInvocation(params: {
    [key: string]: unknown;
  }): ToolInvocation<{ [key: string]: unknown }, ToolResult> {
    return new MockToolInvocation(this, params);
  }
}

/**
 * Configurable mock modifiable tool for testing.
 */
export class MockModifiableTool
  extends MockTool
  implements ModifiableDeclarativeTool<Record<string, unknown>>
{
  readonly shouldConfirmExecuteParams: MockModifiableToolShouldConfirmExecuteParams;
  readonly createUpdatedParamsFn: (
    oldContent: string,
    modifiedProposedContent: string,
    originalParams: Record<string, unknown>,
  ) => Record<string, unknown>;

  constructor(options: MockModifiableToolOptions = {}) {
    super({
      name: 'mockModifiableTool',
      description: 'A mock modifiable tool for testing.',
      params: {
        type: 'object',
        properties: { param: { type: 'string' } },
      },
      ...options,
    });

    this.shouldConfirmExecuteParams =
      options.shouldConfirmExecuteParams ??
      MODIFIABLE_MOCK_TOOL_SHOULD_CONFIRM_EXECUTE_PARAMS;

    this.createUpdatedParamsFn =
      options.createUpdatedParams ??
      ((_oldContent, modifiedProposedContent, _originalParams) => ({
        newContent: modifiedProposedContent,
      }));

    if (!options.shouldConfirmExecute) {
      this.shouldConfirmExecute = async function (
        this: MockModifiableTool,
      ): Promise<ToolCallConfirmationDetails | false> {
        return {
          type: 'edit' as const,
          title: 'Confirm Mock Tool',
          fileName: this.shouldConfirmExecuteParams.filePath,
          filePath: this.shouldConfirmExecuteParams.filePath,
          fileDiff: 'diff',
          originalContent: this.shouldConfirmExecuteParams.currentContent,
          newContent: this.shouldConfirmExecuteParams.proposedContent,
          onConfirm: async () => {},
        };
      }.bind(this);
    }
  }

  getModifyContext(
    _abortSignal: AbortSignal,
  ): ModifyContext<Record<string, unknown>> {
    return {
      getFilePath: () => this.shouldConfirmExecuteParams.filePath,
      getCurrentContent: async () =>
        this.shouldConfirmExecuteParams.currentContent,
      getProposedContent: async () =>
        this.shouldConfirmExecuteParams.proposedContent,
      createUpdatedParams: this.createUpdatedParamsFn,
    };
  }
}
