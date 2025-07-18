/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type MCPServerConfig } from '@google/gemini-cli-core';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';

describe('ContextSummaryDisplay', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no context', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        geminiMdFileCount={0}
        contextFileNames={[]}
        mcpServers={{}}
        activeFile={{ filePath: '' }}
      />,
    );

    expect(lastFrame()).toBe('');
  });

  it('renders only gemini.md files correctly', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        geminiMdFileCount={1}
        contextFileNames={['gemini.md']}
        mcpServers={{}}
        activeFile={{ filePath: '' }}
      />,
    );

    expect(lastFrame()).toContain('Using: 1 gemini.md File');
    expect(lastFrame()).not.toContain('ctrl+u');
  });

  it('renders with active file and shows hint', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        geminiMdFileCount={0}
        contextFileNames={[]}
        mcpServers={{}}
        activeFile={{ filePath: 'foo.ts' }}
      />,
    );

    expect(lastFrame()).toContain('Using: 1 Open File (ctrl+u for details)');
  });

  it('renders with mcp server and shows hint', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        geminiMdFileCount={0}
        contextFileNames={[]}
        mcpServers={{ server1: {} as MCPServerConfig }}
        activeFile={{ filePath: '' }}
      />,
    );

    expect(lastFrame()).toContain('Using: 1 MCP Server (ctrl+u for details)');
  });

  it('renders with everything and shows hint', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        geminiMdFileCount={1}
        contextFileNames={['gemini.md']}
        mcpServers={{ server1: {} as MCPServerConfig }}
        activeFile={{ filePath: 'foo.ts' }}
      />,
    );

    expect(lastFrame()).toContain(
      'Using: 1 MCP Server | 1 gemini.md File | 1 Open File (ctrl+u for details)',
    );
  });

  describe('contextDetails view', () => {
    it('renders details view with hint', () => {
      const { lastFrame } = render(
        <ContextSummaryDisplay
          geminiMdFileCount={1}
          contextFileNames={['gemini.md']}
          mcpServers={{ server1: {} as MCPServerConfig }}
          activeFile={{ filePath: 'foo.ts' }}
          contextDetails={true}
        />,
      );

      expect(lastFrame()).toContain('(ctrl+u to hide)');
    });

    it('renders details view without hint', () => {
      const { lastFrame } = render(
        <ContextSummaryDisplay
          geminiMdFileCount={1}
          contextFileNames={['gemini.md']}
          mcpServers={{}}
          activeFile={{ filePath: '' }}
          contextDetails={true}
        />,
      );

      expect(lastFrame()).not.toContain('(ctrl+u to hide)');
    });
  });
});
