/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type React from 'react';
import { useKeypress, type Key, keyToAnsi } from '../hooks/useKeypress.js';
import { ShellExecutionService, type Config } from '@google/gemini-cli-core';

export interface ShellInputPromptProps {
  config: Config;
  activeShellPtyId: number | null;
  focus?: boolean;
}

export const ShellInputPrompt: React.FC<ShellInputPromptProps> = ({
  config,
  activeShellPtyId,
  focus = true,
}) => {
  const handleShellInputSubmit = useCallback(
    (input: string) => {
      if (activeShellPtyId) {
        ShellExecutionService.writeToPty(activeShellPtyId, input);
      }
    },
    [activeShellPtyId],
  );

  const handleInput = useCallback(
    (key: Key) => {
      if (!focus) {
        return;
      }

      const ansiSequence = keyToAnsi(key);
      if (ansiSequence) {
        handleShellInputSubmit(ansiSequence);
      }
    },
    [focus, handleShellInputSubmit],
  );

  useKeypress(handleInput, { isActive: focus });

  return null;
};
