
import { Box, Text } from 'ink';
import React from 'react';
import { TextBuffer } from './shared/text-buffer.js';
import { useKeypress } from '../hooks/useKeypress.js';

export interface QuietModeInputProps {
  buffer: TextBuffer;
  onSubmit: (value: string) => void;
}

export const QuietModeInput: React.FC<QuietModeInputProps> = ({
  buffer,
  onSubmit,
}) => {
  const handleInput = (key: {
    name: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    sequence: string;
  }) => {
    if (key.name === 'return' && !key.shift && !key.ctrl && !key.meta) {
      onSubmit(buffer.text);
      buffer.setText('');
      return;
    }
    buffer.handleInput({ ...key, paste: false });
  };

  useKeypress(handleInput, { isActive: true });

  return (
    <Box>
      <Text>Input: </Text>
      <Text>{buffer.text}</Text>
    </Box>
  );
};
