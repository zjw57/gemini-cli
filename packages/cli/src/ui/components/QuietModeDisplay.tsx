/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text, useStdin } from 'ink';
import {
  HistoryItem,
  HistoryItemGemini,
  HistoryItemGeminiContent,
  HistoryItemToolGroup,
  MessageType,
  StreamingState,
} from '../types.js';
import { QuietModeInput } from './QuietModeInput.js';
import { useTextBuffer } from './shared/text-buffer.js';
import { useCallback, useEffect, useState } from 'react';
import { useGeminiStream } from '../hooks/useGeminiStream.js';
import { Config } from '@google/gemini-cli-core';

interface QuietModeDisplayProps {
  config: Config;
}

export const QuietModeDisplay = ({ config }: QuietModeDisplayProps) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const { stdin, setRawMode } = useStdin();
  const [streamingOutput, setStreamingOutput] = useState('');

  const addItem = useCallback((item: HistoryItem) => {
    setHistory((prev) => [...prev, item]);
  }, []);

  useEffect(() => {
    const lastItem = history[history.length - 1];
    if (lastItem?.type === 'gemini' || lastItem?.type === 'gemini_content') {
      setStreamingOutput(
        (lastItem as HistoryItemGemini | HistoryItemGeminiContent).text,
      );
    }
  }, [history]);

  const { streamingState, submitQuery } = useGeminiStream(
    config.getGeminiClient(),
    history,
    (itemData) => {
      // This is a bit of a hack, but we need to add an id to the item
      // so that it can be added to the history.
      addItem({ ...itemData, id: Date.now() } as HistoryItem);
      return 0;
    },
    () => {}, // setShowHelp not needed
    config,
    () => {}, // setDebugMessage not needed
    async () => false, // handleSlashCommand not needed
    false, // shellModeActive not needed
    () => undefined, // getPreferredEditor not needed
    () => {}, // onAuthError not needed
    async () => {}, // performMemoryRefresh not needed
  );

  const buffer = useTextBuffer({
    initialText: '',
    viewport: { height: 1, width: 80 },
    stdin,
    setRawMode,
    isValidPath: () => false,
  });

  const handleSubmit = (text: string) => {
    setStreamingOutput('');
    submitQuery(text);
  };

  const renderHistoryItem = (item: HistoryItem, index: number) => {
    switch (item.type) {
      case 'user':
        return (
          <Box key={index} flexDirection="column">
            <Text bold color="blue">
              You
            </Text>
            <Text>{item.text}</Text>
          </Box>
        );
      case 'gemini':
      case 'gemini_content':
        return (
          <Box key={index} flexDirection="column">
            <Text bold color="green">
              Gemini
            </Text>
            <Text>{item.text}</Text>
          </Box>
        );
      case 'tool_group':
        return (
          <Box key={index} flexDirection="column">
            <Text bold color="yellow">
              Tool Calls
            </Text>
            {(item as HistoryItemToolGroup).tools.map((tool, toolIndex) => (
              <Text key={toolIndex}>
                - {tool.name}: {tool.status}
              </Text>
            ))}
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column">
      {history.map(renderHistoryItem)}
      {streamingState === StreamingState.Responding && (
        <Box flexDirection="column">
          <Text bold color="green">
            Gemini
          </Text>
          <Text>{streamingOutput}</Text>
        </Box>
      )}
      {streamingState === StreamingState.Idle && (
        <QuietModeInput buffer={buffer} onSubmit={handleSubmit} />
      )}
    </Box>
  );
};
