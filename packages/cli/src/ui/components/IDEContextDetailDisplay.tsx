/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { type IDEContext } from '@google/gemini-cli-core';
import { Colors } from '../colors.js';
import path from 'node:path';

interface IDEContextDetailDisplayProps {
  ideContext: IDEContext | undefined;
}

export function IDEContextDetailDisplay({
  ideContext,
}: IDEContextDetailDisplayProps) {
  const recentOpenFiles = ideContext?.workspaceState?.recentOpenFiles;
  if (!recentOpenFiles || recentOpenFiles.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={Colors.AccentCyan}
      paddingX={1}
    >
      <Text color={Colors.AccentCyan} bold>
        IDE Context (ctrl+e to toggle)
      </Text>
      {recentOpenFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Recent open files:</Text>
          {recentOpenFiles.map((file) => (
            <Text key={file.filePath}>
              - {path.basename(file.filePath)}
              {file.filePath === ideContext?.activeContext?.file.filePath
                ? ' (active)'
                : ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
