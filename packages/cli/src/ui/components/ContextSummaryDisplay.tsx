/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ActiveFile, type MCPServerConfig } from '@google/gemini-cli-core';
import { Box, Text } from 'ink';
import React, { useMemo } from 'react';
import { Colors } from '../colors.js';
import { InfoMessage } from './messages/InfoMessage.js';

interface ContextSummaryDisplayProps {
  geminiMdFileCount: number;
  contextFileNames: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  activeFile?: ActiveFile;
  contextDetails?: boolean;
}

export const ContextSummaryDisplay: React.FC<ContextSummaryDisplayProps> = ({
  geminiMdFileCount,
  contextFileNames,
  mcpServers,
  activeFile,
  contextDetails,
}) => {
  const mcpServerCount = Object.keys(mcpServers || {}).length;

  const hasGeminiMdFiles = geminiMdFileCount > 0;
  const hasMcpServers = mcpServerCount > 0;
  const hasActiveFile = !!activeFile?.filePath;

  const geminiMdText = (() => {
    if (geminiMdFileCount === 0) {
      return '';
    }
    const allNamesTheSame = new Set(contextFileNames).size < 2;
    const name = allNamesTheSame ? contextFileNames[0] : 'Context';
    return `${name} File${geminiMdFileCount > 1 ? 's' : ''}`;
  })();

  if (!hasGeminiMdFiles && !hasMcpServers && !hasActiveFile) {
    return <Text> </Text>; // Reserve height for layout stability.
  }

  if (contextDetails) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <InfoMessage text="Files:" />
        {geminiMdFileCount > 0 && (
          <Box flexDirection="column" marginLeft={2}>
            <Text color={Colors.AccentYellow}>Context</Text>
            {contextFileNames.map((item) => (
              <Text key={item}>- {item}</Text>
            ))}
          </Box>
        )}
        {activeFile?.filePath && (
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            <Text color={Colors.AccentYellow}>Open File</Text>
            <Text> - {activeFile.filePath}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={Colors.Gray}>(ctrl+d to hide)</Text>
        </Box>
      </Box>
    );
  }

  const summaryParts: string[] = [];
  if (hasMcpServers) {
    summaryParts.push(
      `${mcpServerCount} MCP Server${mcpServerCount !== 1 ? 's' : ''}`,
    );
  }
  if (geminiMdText) {
    summaryParts.push(`${geminiMdFileCount} ${geminiMdText}`);
  }
  if (hasActiveFile) {
    summaryParts.push('1 Open File');
  }

  return (
    <Box paddingX={1}>
      <Text color={Colors.Gray}>
        Using: {summaryParts.join(' | ')} (ctrl+d for details)
      </Text>
    </Box>
  );
};
