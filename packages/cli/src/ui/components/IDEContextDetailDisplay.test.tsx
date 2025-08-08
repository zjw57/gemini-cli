/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { IDEContextDetailDisplay } from './IDEContextDetailDisplay.js';
import { type IdeContext } from '@google/gemini-cli-core';

describe('IDEContextDetailDisplay', () => {
  it('renders an empty string when there are no open files', () => {
    const ideContext: IdeContext = {
      workspaceState: {
        openFiles: [],
      },
    };
    const { lastFrame } = render(
      <IDEContextDetailDisplay
        ideContext={ideContext}
        detectedIdeDisplay="VS Code"
        isFileSelected={() => false}
      />,
    );
    expect(lastFrame()).toBe('');
  });

  it('renders a list of open files with active status', () => {
    const ideContext: IdeContext = {
      workspaceState: {
        openFiles: [
          { path: '/foo/bar.txt', isActive: true, timestamp: 0 },
          { path: '/foo/baz.txt', isActive: false, timestamp: 0 },
        ],
      },
    };
    const { lastFrame } = render(
      <IDEContextDetailDisplay
        ideContext={ideContext}
        detectedIdeDisplay="VS Code"
        isFileSelected={(path) => path === '/foo/bar.txt'}
      />,
    );
    const output = lastFrame();
    expect(output).toMatchSnapshot();
  });

  it('handles duplicate basenames by showing path hints', () => {
    const ideContext: IdeContext = {
      workspaceState: {
        openFiles: [
          { path: '/foo/bar.txt', isActive: true, timestamp: 0 },
          { path: '/qux/bar.txt', isActive: false, timestamp: 0 },
          { path: '/foo/unique.txt', isActive: false, timestamp: 0 },
        ],
      },
    };
    const { lastFrame } = render(
      <IDEContextDetailDisplay
        ideContext={ideContext}
        detectedIdeDisplay="VS Code"
        isFileSelected={(path) => path === '/foo/bar.txt'}
      />,
    );
    const output = lastFrame();
    expect(output).toMatchSnapshot();
  });
});
