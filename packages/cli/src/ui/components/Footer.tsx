/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { shortenPath, tildeifyPath } from '@gemini-cli/core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';

interface FooterProps {
  targetDir: string;
  branchName?: string;
  errorCount: number;
  showErrorDetails: boolean;
  fileCount: number;
  showContext: boolean;
}

export const Footer: React.FC<FooterProps> = ({
  targetDir,
  branchName,
  errorCount,
  showErrorDetails,
  fileCount,
  showContext,
}) => {
  const tokenCount = fileCount > 0 ? '194k' : '46k';
  const tokenPercentage = fileCount > 0 ? '20%' : '5%';

  return (
    <Box marginTop={1} justifyContent="space-between" width="100%">
      <Box>
        <Text color={Colors.LightBlue}>
          {shortenPath(tildeifyPath(targetDir), 40)}
          {branchName && <Text color={Colors.Gray}> ({branchName}*)</Text>}
        </Text>
      </Box>

      <Box flexGrow={1} justifyContent="center">
        <Text>
          <Text color={Colors.AccentGreen}>
            {tokenCount} / {tokenPercentage}
          </Text>
          <Text color={Colors.Gray}> / </Text>
          <Text>
            {fileCount} file{fileCount !== 1 && 's'}
          </Text>
          <Text color={Colors.Gray}>
            {' '}
            (Ctrl-F for {showContext ? 'less' : 'more'})
          </Text>
        </Text>
      </Box>

      <Box>
        {!showErrorDetails && errorCount > 0 && (
          <Box>
            <Text color={Colors.Gray}>| </Text>
            <ConsoleSummaryDisplay errorCount={errorCount} />
          </Box>
        )}
      </Box>
    </Box>
  );
};
