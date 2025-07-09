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
      : undefined; // Get the last one

    const messageContent = lastAiMessage
      ? `Last output copied to clipboard`
      : 'No output in history';

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: messageContent,
      },
      Date.now(),
    );

    if (lastAiMessage) {
      // Extract text from the parts
      const lastAiOutput = lastAiMessage.parts
        ?.filter((part) => part.text) // Filter parts that have text
        .map((part) => part.text) // Extract the text
        .join(''); // Join multiple text parts

      if (lastAiOutput) {
        try {
          await copyToClipboard(lastAiOutput);
          context.ui.setDebugMessage('Copied last result to clipboard!');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          context.ui.setDebugMessage(
            `Error: Could not copy to clipboard. ${message}`,
          );
        }
      } else {
        context.ui.setDebugMessage('No result/snippet found to copy.');
      }
    }
  },
};
