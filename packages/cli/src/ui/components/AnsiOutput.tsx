/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text } from 'ink';
import type { AnsiLine, AnsiOutput, AnsiToken } from '@google/gemini-cli-core';

interface AnsiOutputProps {
  data: AnsiOutput;
  availableTerminalHeight?: number;
}

export const AnsiOutputText: React.FC<AnsiOutputProps> = ({
  data,
  availableTerminalHeight,
}) => {
  const lastLines = data.slice(
    -(availableTerminalHeight && availableTerminalHeight > 0
      ? availableTerminalHeight
      : 24),
  );
  return lastLines.map((line: AnsiLine, lineIndex: number) => (
    <Text key={lineIndex}>
      {line.length > 0 ? (
        line.map((token: AnsiToken, tokenIndex: number) => (
          <Text
            key={tokenIndex}
            color={token.inverse ? token.bg : token.fg}
            backgroundColor={token.inverse ? token.fg : token.bg}
            dimColor={token.dim}
            bold={token.bold}
            italic={token.italic}
            underline={token.underline}
          >
            {token.text}
          </Text>
        ))
      ) : (
        <Text> </Text>
      )}
    </Text>
  ));
};
