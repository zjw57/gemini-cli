/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IdeContextWithCheckedFiles,
  type IdeFile,
} from '@google/gemini-cli-core';
import { Box, Text, useInput } from 'ink';
import path from 'node:path';
import { useEffect, useState } from 'react';
import { Colors } from '../colors.js';

interface IDEContextDetailDisplayProps {
  ideContext: IdeContextWithCheckedFiles | undefined;
  detectedIdeDisplay: string | undefined;
  onFileChecked: (path: string, isChecked: boolean) => void;
  isActive: boolean;
}

export function IDEContextDetailDisplay({
  ideContext,
  detectedIdeDisplay,
  onFileChecked,
  isActive,
}: IDEContextDetailDisplayProps) {
  const openFiles = ideContext?.workspaceState?.openFiles;
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!openFiles) {
      return;
    }
    const activeFileIndex = openFiles.findIndex((file) => file.isActive);
    setSelectedIndex(activeFileIndex === -1 ? 0 : activeFileIndex);
  }, [openFiles]);

  useInput(
    (_, key) => {
      if (!openFiles) {
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(openFiles.length - 1, prev + 1));
      }

      if (key.return) {
        const file = openFiles[selectedIndex];
        if (file) {
          onFileChecked(file.path, !file.isChecked);
        }
      }
    },
    { isActive },
  );

  if (!openFiles || openFiles.length === 0) {
    return null;
  }

  const borderColor = isActive ? Colors.AccentBlue : Colors.AccentCyan;
  const titleText = detectedIdeDisplay ? detectedIdeDisplay : 'IDE';
  const instructionText = isActive
    ? ' (use arrows, enter to toggle, esc to exit)'
    : ' (ctrl+e to focus)';

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text color={borderColor} bold>
        {titleText} Context
        {instructionText}
      </Text>
      {openFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Open files:</Text>
          {openFiles.map((file: IdeFile, index) => {
            const isSelected = index === selectedIndex;
            return (
              <Text
                key={file.path}
                color={isSelected ? Colors.AccentCyan : undefined}
              >
                {file.isChecked ? '[x]' : '[ ]'} {path.basename(file.path)}
                {file.isActive ? ' (active)' : ''}
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
