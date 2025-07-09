/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyToClipboard } from '../utils/commandUtils.js';
import { SlashCommand } from './types.js';
import { MessageType } from '../types.js';

export const copyCommand: SlashCommand = {
  name: 'copy',
  description: 'Copy the last result or code snippet to clipboard',
  action: async (context, _args) => {
    const chat = await context.services.config?.getGeminiClient()?.getChat();
    const history = chat?.getHistory();

    // Get the last message from the AI (model role)
    const lastAiMessage = history
      ? history.filter((item) => item.role === 'model').pop()
      : undefined;

    if (!lastAiMessage) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No output in history',
        },
        Date.now(),
      );
      return;
    }
    // Extract text from the parts
    const lastAiOutput = lastAiMessage.parts
      ?.filter((part) => part.text)
      .map((part) => part.text)
      .join('');

    if (lastAiOutput) {
      try {
        await copyToClipboard(lastAiOutput);
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: 'Last output copied to the clipboard',
          },
          Date.now(),
        );
        context.ui.setDebugMessage('Copied last result to the clipboard!');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.ui.setDebugMessage(
          `Error: Could not copy to the clipboard. ${message}`,
        );
        context.ui.addItem(
          {
            type: MessageType.ERROR,
            text: 'Failed to copy to the clipboard.',
          },
          Date.now(),
        );
      }
    } else {
      context.ui.setDebugMessage('No result/snippet found to copy.');
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'Last AI output contains no text to copy.',
        },
        Date.now(),
      );
    }
  },
};
