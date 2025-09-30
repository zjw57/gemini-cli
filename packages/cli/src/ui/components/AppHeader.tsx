/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Header } from './Header.js';
import { Tips } from './Tips.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { theme } from '../semantic-colors.js';
import { type IdeContext, type MCPServerConfig } from '@google/gemini-cli-core';

interface AppHeaderProps {
  version: string;
  ideContextState?: IdeContext;
  geminiMdFileCount: number;
  contextFileNames: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  showToolDescriptions: boolean;
}

export const AppHeader = ({
  version,
  ideContextState,
  geminiMdFileCount,
  contextFileNames,
  mcpServers,
  blockedMcpServers,
  showToolDescriptions,
}: AppHeaderProps) => {
  const settings = useSettings();
  const config = useConfig();
  const { nightly } = useUIState();

  if (settings.merged.ui?.minimal) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Text>
            <Text bold color={theme.text.accent}>
              ✦
            </Text>{' '}
            <Text bold>Gemini CLI</Text>{' '}
            <Text color={theme.text.secondary}>v{version}</Text>
          </Text>
        </Box>
        <ContextSummaryDisplay
          ideContext={ideContextState}
          geminiMdFileCount={geminiMdFileCount}
          contextFileNames={contextFileNames}
          mcpServers={mcpServers}
          blockedMcpServers={blockedMcpServers}
          showToolDescriptions={showToolDescriptions}
          minimal={true}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {!(settings.merged.ui?.hideBanner || config.getScreenReader()) && (
        <Header version={version} nightly={nightly} />
      )}
      {!(settings.merged.ui?.hideTips || config.getScreenReader()) && (
        <Tips config={config} />
      )}
    </Box>
  );
};
