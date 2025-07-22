/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { type OpenFiles } from '@google/gemini-cli-core';
import { Colors } from '../colors.js';
import path from 'node:path';

interface IDEContextDetailDisplayProps {
  openFiles: OpenFiles | undefined;
}

export function IDEContextDetailDisplay({
  openFiles,
}: IDEContextDetailDisplayProps) {
  if (!openFiles || (!openFiles.activeFile && !openFiles.recentOpenFiles)) {
    return null;
  }

  const recentFiles = openFiles.recentOpenFiles || [];

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={Colors.AccentCyan}
      paddingX={1}
    >
      <Text color={Colors.AccentCyan} bold>
        File Context (ctrl+e to close)
      </Text>
      {openFiles.activeFile && (
        <Box>
          <Text bold>Active File: </Text>
          <Text>{path.basename(openFiles.activeFile)}</Text>
        </Box>
      )}
      {recentFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Recent Files:</Text>
          {recentFiles.map((file, index) => (
            <Text key={index}>- {path.basename(file.filePath)}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
