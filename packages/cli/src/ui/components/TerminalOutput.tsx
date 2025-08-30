/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';

interface TerminalOutputProps {
  output: string;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({
  output,
}) => {
  const lines = output.split('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
};

