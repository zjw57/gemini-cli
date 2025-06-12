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

import { useTokenCounts } from '../hooks/useTokenCounts.js';

interface FooterProps {
  targetDir: string;
  branchName?: string;
  errorCount: number;
  showErrorDetails: boolean;
  fileCount: number;
  showContext: boolean;
  tokenBreakdown: {
    chatTokens: number;
    conventionsTokens: number;
    systemTokens: number;
  };
  filesWithTokens: Array<{ path: string; tokenCount: number }>;
  tokenLimit: number;
}

export const Footer: React.FC<FooterProps> = ({
  targetDir,
  branchName,
  errorCount,
  showErrorDetails,
  fileCount,
  showContext,
  tokenBreakdown,
  filesWithTokens,
  tokenLimit,
}) => {
  const { totalTokens, totalPercentage } = useTokenCounts(
    tokenBreakdown,
    filesWithTokens,
    tokenLimit,
  );

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
            {totalTokens} / {totalPercentage}
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
