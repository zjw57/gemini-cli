/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand } from './types.js';

export const pushScopeCommand: SlashCommand = {
  name: 'pushscope',
  description: 'Push a new scope to the chat stack',
  action: async (context) => {
    context.services.config?.getGeminiClient().pushScope();
    return {
      type: 'message',
      messageType: 'info',
      content: 'New scope pushed.',
    };
  },
};
