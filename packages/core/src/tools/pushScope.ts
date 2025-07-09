/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { Config } from '../config/config.js';
import { Schema, Type } from '@google/genai';

export class PushScopeTool extends BaseTool<object, ToolResult> {
  static readonly Name = 'push_scope';

  constructor(readonly config: Config) {
    super(
      PushScopeTool.Name,
      'PushScopeTool',
      'Pushes a new scope to the chat stack, allowing for a temporary "fork" of the conversation. Any interactions after this will be in the new scope until `pop_scope` is called.',
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
    client.pushScope();
    console.log('PUSHING NEW SCOPE');
    const result = 'New scope pushed.';
    return {
      llmContent: result,
      returnDisplay: result,
    };
  }
}
