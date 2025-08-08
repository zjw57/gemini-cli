/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type File, type IdeContext } from '@google/gemini-cli-core';
import { Box, Text, useInput } from 'ink';
import path from 'node:path';
import { useEffect, useState } from 'react';
import { theme } from '../semantic-colors.js';

interface IDEContextDetailDisplayProps {
  ideContext: IdeContext | undefined;
  detectedIdeDisplay: string | undefined;
  isFileSelected: (path: string) => boolean;
  selectFile: (path: string) => void;
  deselectFile: (path: string) => void;
  isFocused: boolean;
}

export function IDEContextDetailDisplay({
  ideContext: propsIdeContext,
  detectedIdeDisplay,
  isFileSelected,
  selectFile,
  deselectFile,
  isFocused,
}: IDEContextDetailDisplayProps) {
  const openFiles = propsIdeContext?.workspaceState?.openFiles;
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (openFiles && focusIndex >= openFiles.length) {
      setFocusIndex(Math.max(0, openFiles.length - 1));
    }
  }, [openFiles, focusIndex]);

  useInput(
    (input, key) => {
      if (!openFiles || openFiles.length === 0) {
        return;
      }
      if (key.upArrow) {
        setFocusIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setFocusIndex((prev) => Math.min(openFiles.length - 1, prev + 1));
      } else if (key.return) {
        const focusedFile = openFiles[focusIndex];
        if (focusedFile) {
          if (isFileSelected(focusedFile.path)) {
            deselectFile(focusedFile.path);
          } else {
            selectFile(focusedFile.path);
          }
        }
      }
    },
    { isActive: isFocused },
  );

  if (!openFiles || openFiles.length === 0) {
    return null;
  }

  const basenameCounts = new Map<string, number>();
  for (const file of openFiles) {
    const basename = path.basename(file.path);
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  const borderColor = isFocused ? theme.border.focused : theme.border.default;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text color={theme.text.primary} bold>
        {`${detectedIdeDisplay ? detectedIdeDisplay : 'IDE'} Context`}
      </Text>
      {openFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Open files:</Text>
          {openFiles.map((file: File, index) => {
            const basename = path.basename(file.path);
            const isDuplicate = (basenameCounts.get(basename) || 0) > 1;
            const parentDir = path.basename(path.dirname(file.path));
            const displayName = isDuplicate
              ? `${basename} (/${parentDir})`
              : basename;
            const isSelected = isFileSelected(file.path);
            const isCurrentlyFocused = index === focusIndex;
            const indicator = isSelected ? '[✓]' : '[ ]';

            const textColor =
              isCurrentlyFocused && isFocused
                ? theme.text.accent
                : theme.text.primary;

            return (
              <Box key={file.path} paddingX={1} flexGrow={1}>
                <Text color={textColor}>
                  {indicator} {displayName}
                  {file.isActive ? ' (active)' : ''}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {isFocused ? (
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            Use ↑↓ to navigate, Enter to select/unselect files.
          </Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            Press Tab to edit included context.
          </Text>
        </Box>
      )}
    </Box>
  );
}
