/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ActiveFile, type MCPServerConfig } from '@google/gemini-cli-core';
import { Box, Text } from 'ink';
import React, { useMemo } from 'react';
import path from 'path';
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

  const contextFileLabel = useMemo(() => {
    if (!hasGeminiMdFiles || contextFileNames.length === 0) return 'Context';
    const allBaseNamesTheSame =
      new Set(contextFileNames.map((p) => path.basename(p))).size < 2;
    return allBaseNamesTheSame ? path.basename(contextFileNames[0]) : 'Context';
  }, [contextFileNames, hasGeminiMdFiles]);

  if (!hasGeminiMdFiles && !hasMcpServers && !hasActiveFile) {
    return <Text> </Text>; // Reserve height for layout stability.
  }

  if (contextDetails) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <InfoMessage text="Files:" />
        <Box flexDirection="column" marginLeft={2}>
          {contextFileNames.map((item) => (
            <Text key={item} color={Colors.AccentYellow}>
              - {item}
            </Text>
          ))}
        </Box>
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
  if (hasGeminiMdFiles) {
    summaryParts.push(
      `${geminiMdFileCount} ${contextFileLabel} File${
        geminiMdFileCount !== 1 ? 's' : ''
      }`,
    );
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
