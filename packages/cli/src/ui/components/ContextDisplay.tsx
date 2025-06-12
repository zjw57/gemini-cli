/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';

interface ContextDisplayProps {
  // Using placeholder data for now
}

export const ContextDisplay: React.FC<ContextDisplayProps> = () => {
  const totalTokens = '193k';
  const totalPercentage = '15%';
  const systemTokens = '42k';
  const historyTokens = '45k';
  const conventionsTokens = '24k';
  const filesTokens = '35k';
  const fileCount = 29;

  const files = [
    { name: 'packages/cli/src/ui/components/Footer.tsx', tokens: '12k' },
    { name: 'packages/cli/src/ui/components/ContextDisplay.tsx', tokens: '9k' },
    { name: 'packages/cli/src/ui/components/InputPrompt.tsx', tokens: '8k' },
    { name: 'other/file/here.md', tokens: '31k' },
  ];

  const remainingFiles = fileCount - files.length;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color={Colors.Gray}>Token breakdown: </Text>
        <Text color={Colors.AccentGreen}>{totalTokens} ({totalPercentage}) total</Text>
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
            <Text color={Colors.Gray}>...{remainingFiles} more... adjust with /track, /untrack</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
};
