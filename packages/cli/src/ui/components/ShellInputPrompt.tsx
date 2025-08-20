/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useKeypress, Key, keyToAnsi } from '../hooks/useKeypress.js';
import chalk from 'chalk';

const CURSOR_BLINK_RATE_MS = 500;

export interface ShellInputPromptProps {
  onSubmit: (value: string) => void;
  focus?: boolean;
}

export const ShellInputPrompt: React.FC<ShellInputPromptProps> = ({
  onSubmit,
  focus = true,
}) => {
  const [isCursorVisible, setIsCursorVisible] = useState(true);

  useEffect(() => {
    if (!focus) {
      setIsCursorVisible(true);
      return;
    }

    const blinker = setInterval(() => {
      setIsCursorVisible((prev) => !prev);
    }, CURSOR_BLINK_RATE_MS);
    return () => {
      clearInterval(blinker);
    };
  }, [focus]);

  const handleInput = useCallback(
    (key: Key) => {
      if (!focus) {
        return;
      }
      setIsCursorVisible(true);

      const ansiSequence = keyToAnsi(key);
      if (ansiSequence) {
        onSubmit(ansiSequence);
      }
    },
    [focus, onSubmit],
  );

  useKeypress(handleInput, { isActive: focus });

  const cursor = isCursorVisible ? chalk.inverse(' ') : ' ';

  return <Box>{focus && <Text>{cursor}</Text>}</Box>;
};
