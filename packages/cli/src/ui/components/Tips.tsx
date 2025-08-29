/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { type Config } from '@google/gemini-cli-core';
import { type Extension } from '../../config/extension.js';

interface TipsProps {
  config: Config;
  extensions: Extension[];
}

export const Tips: React.FC<TipsProps> = ({ config, extensions }) => {
  const geminiMdFileCount = config.getGeminiMdFileCount();
  const tips = [];
  tips.push('Ask questions, edit files, or run commands.');
  tips.push('Be specific for the best results.');
  if (geminiMdFileCount === 0) {
    tips.push(
      <>
        Create{' '}
        <Text bold color={Colors.AccentPurple}>
          GEMINI.md
        </Text>{' '}
        files to customize your interactions with Gemini.
      </>,
    );
  }
  if (extensions.length > 0) {
    tips.push(
      <>
        <Text bold color={Colors.AccentPurple}>
          /extensions
        </Text>{' '}
        to see your installed extensions.
      </>,
    );
  }
  tips.push(
    <>
      <Text bold color={Colors.AccentPurple}>
        /help
      </Text>{' '}
      for more information.
    </>,
  );

  return (
    <Box flexDirection="column">
      <Text color={Colors.Foreground}>Tips for getting started:</Text>
      {tips.map((tip, index) => (
        <Text key={index} color={Colors.Foreground}>
          {index + 1}. {tip}
        </Text>
      ))}
    </Box>
  );
};
