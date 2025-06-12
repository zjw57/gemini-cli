/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { FileContextService } from '@gemini-cli/core';
import path from 'path';

interface ContextDisplayProps {
  filesWithTokens: Array<{ path: string; tokenCount: number }>;
  projectRoot: string;
}

export const ContextDisplay: React.FC<ContextDisplayProps> = ({
  filesWithTokens,
  projectRoot,
}) => {

  const totalTokens = filesWithTokens
    .reduce((acc, file) => acc + file.tokenCount, 0)
    .toLocaleString();
  const totalPercentage = '15%';
  const systemTokens = '42k';
  const historyTokens = '45k';
  const conventionsTokens = '24k';
  const filesTokens = filesWithTokens
    .reduce((acc, file) => acc + file.tokenCount, 0)
    .toLocaleString();
  const fileCount = filesWithTokens.length;

  const files = filesWithTokens.map((file) => ({
    name: path.relative(projectRoot, file.path),
    tokens: `${(file.tokenCount / 1000).toFixed(1)}k`,
  }));

  const remainingFiles = fileCount - files.length;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={Colors.Gray}>Token breakdown: </Text>
        <Text color={Colors.AccentGreen}>
          {totalTokens} ({totalPercentage}) total
        </Text>
        <Text color={Colors.Gray}> | </Text>
        <Text color={Colors.Gray}>System: </Text>
        <Text>{systemTokens}</Text>
        <Text color={Colors.Gray}> • History: </Text>
        <Text>{historyTokens}</Text>
        <Text color={Colors.Gray}> • Conventions: </Text>
        <Text>{conventionsTokens}</Text>
        <Text color={Colors.Gray}> • Files ({fileCount}): </Text>
        <Text>{filesTokens}</Text>
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        {files.map((file, index) => (
          <Text key={index}>
            <Text color={Colors.LightBlue}>{file.tokens.padStart(5)}</Text>
            <Text> {file.name}</Text>
          </Text>
        ))}
        {remainingFiles > 0 && (
          <Text>
            <Text color={Colors.Gray}>
              ...{remainingFiles} more... adjust with /track, /untrack
            </Text>
          </Text>
        )}
      </Box>
    </Box>
  );
};
