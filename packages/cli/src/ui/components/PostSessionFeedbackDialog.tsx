/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { Colors } from '../colors.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';

export enum SessionRating {
  TERRIBLE = 1,
  BAD = 2,
  OKAY = 3,
  GOOD = 4,
  GREAT = 5,
}

export interface PostSessionFeedbackDialogProps {
  onSelect: (feedback: SessionRating | undefined) => void;
}

export const PostSessionFeedbackDialog: React.FC<PostSessionFeedbackDialogProps> = ({ onSelect }) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onSelect(undefined);
      }
    },
    { isActive: true },
  );

  const handleSelect = (item?: SessionRating) => {
    onSelect(item);
  };

  const options: Array<RadioSelectItem<SessionRating>> = [
    {
      label: '😠 Terrible',
      value: SessionRating.TERRIBLE,
    },
    {
      label: '🙁 Bad',
      value: SessionRating.BAD,
    },
    {
      label: '😐 Okay',
      value: SessionRating.OKAY,
    },
    {
      label: '🙂 Good',
      value: SessionRating.GOOD,
    },
    {
      label: '😄 Great',
      value: SessionRating.GREAT,
    },
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      padding={1}
      marginTop={600}
      width="100%"
      marginLeft={1}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Session Feedback (Esc to return)</Text>
        <Text>How would you rate your session?</Text>
      </Box>

      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused
        initialIndex={2}
      />
    </Box>
  );
};
