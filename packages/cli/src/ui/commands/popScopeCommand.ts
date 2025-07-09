/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand } from './types.js';

export const popScopeCommand: SlashCommand = {
  name: 'popscope',
  description: 'Pop the current scope from the chat stack',
  action: async (context) => {
    context.services.config?.getGeminiClient().popScope();
    return {
      type: 'message',
      messageType: 'info',
      content: 'Scope popped.',
    };
  },
};
