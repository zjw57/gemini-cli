/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { Config } from '../config/config.js';
import { Schema, Type } from '@google/genai';

export class PopScopeTool extends BaseTool<object, ToolResult> {
  static readonly Name = 'pop_scope';

  constructor(readonly config: Config) {
    super(
      PopScopeTool.Name,
      'PopScopeTool',
      'Pops the current scope from the chat stack, returning to the previous conversation state. The original scope cannot be popped.',
      {
        type: Type.OBJECT,
        properties: {},
        required: [],
      } as Schema,
      false,
    );
  }

  async execute(): Promise<ToolResult> {
    const client = this.config.getGeminiClient();
    client.popScope();

    console.log('POPPING SCOPE!');
    const result = 'Scope popped.';
    return {
      llmContent: result,
      returnDisplay: result,
    };
  }
}
