/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { StreamingState } from '../types.js';

export interface UseMessageQueueOptions {
  isConfigInitialized: boolean;
  streamingState: StreamingState;
  submitQuery: (query: string) => void;
}

export interface UseMessageQueueReturn {
  messageQueue: string[];
  addMessage: (message: string) => void;
  clearQueue: () => void;
  getQueuedMessagesText: () => string;
  popAllMessages: (onPop: (messages: string | undefined) => void) => void;
}

/**
 * Hook for managing message queuing during streaming responses.
 * Allows users to queue messages while the AI is responding and automatically
 * sends them when streaming completes.
 */
export function useMessageQueue({
  isConfigInitialized,
  streamingState,
  submitQuery,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  // Add a message to the queue
  const addMessage = useCallback((message: string) => {
    const trimmedMessage = message.trim();
    if (trimmedMessage.length > 0) {
      setMessageQueue((prev) => [...prev, trimmedMessage]);
    }
  }, []);

  // Clear the entire queue
  const clearQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);

  // Get all queued messages as a single text string
  const getQueuedMessagesText = useCallback(() => {
    if (messageQueue.length === 0) return '';
    return messageQueue.join('\n\n');
  }, [messageQueue]);

  // Pop all messages from the queue and return them as a single string
  const popAllMessages = useCallback(
    (onPop: (messages: string | undefined) => void) => {
      setMessageQueue((prev) => {
        if (prev.length === 0) {
          onPop(undefined);
          return prev;
        }
        // Join all messages with double newlines, same as when they're sent
        const allMessages = prev.join('\n\n');
        onPop(allMessages);
        return []; // Clear the entire queue
      });
    },
    [],
  );

  // Process queued messages when streaming becomes idle
  useEffect(() => {
    if (
      isConfigInitialized &&
      streamingState === StreamingState.Idle &&
      messageQueue.length > 0
    ) {
      // Combine all messages with double newlines for clarity
      const combinedMessage = messageQueue.join('\n\n');
      // Clear the queue and submit
      setMessageQueue([]);
      submitQuery(combinedMessage);
    }
  }, [isConfigInitialized, streamingState, messageQueue, submitQuery]);

  return {
    messageQueue,
    addMessage,
    clearQueue,
    getQueuedMessagesText,
    popAllMessages,
  };
}
