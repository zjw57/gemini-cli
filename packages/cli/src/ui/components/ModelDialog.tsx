/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useUIActions } from '../contexts/UIActionsContext.js';

const items = [
  {
    label: 'Default - The default model for your organization',
    value: 'default',
  },
  {
    label: 'Pro - The most capable model for complex tasks',
    value: 'pro',
  },
  {
    label: 'Flash - A lighter-weight model for everyday tasks',
    value: 'flash',
  },
  {
    label: 'Flash light - The lightest-weight model for the simplest tasks',
    value: 'flash-light',
  },
];

const ModelDialog = memo(() => {
  const { closeModelDialog } = useUIActions();
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Select a model</Text>
      <RadioButtonSelect items={items} onSelect={closeModelDialog} />
    </Box>
  );
});

ModelDialog.displayName = 'ModelDialog';

export { ModelDialog };
