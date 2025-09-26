/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { Footer } from './Footer.js';
import { NARROW_WIDTH_BREAKPOINT } from '../utils/isNarrowWidth.js';
import * as useTerminalSize from '../hooks/useTerminalSize.js';
import { tildeifyPath } from '@google/gemini-cli-core';
import path from 'node:path';

vi.mock('../hooks/useTerminalSize.js');
const useTerminalSizeMock = vi.mocked(useTerminalSize.useTerminalSize);

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...original,
    shortenPath: (p: string, len: number) => {
      if (p.length > len) {
        return '...' + p.slice(p.length - len + 3);
      }
      return p;
    },
  };
});

const defaultProps = {
  model: 'gemini-pro',
  targetDir:
    '/Users/test/project/foo/bar/and/some/more/directories/to/make/it/long',
  branchName: 'main',
  debugMode: false,
  debugMessage: '',
  corgiMode: false,
  errorCount: 0,
  showErrorDetails: false,
  showMemoryUsage: false,
  promptTokenCount: 100,
  nightly: false,
};

const renderWithWidth = (width: number, props = defaultProps) => {
  useTerminalSizeMock.mockReturnValue({ columns: width, rows: 24 });
  return render(<Footer {...props} />);
};

describe('<Footer />', () => {
  it('renders the component', () => {
    const { lastFrame } = renderWithWidth(120);
    expect(lastFrame()).toBeDefined();
  });

  describe('path display', () => {
    it('should display a shortened path on a wide terminal', () => {
      const { lastFrame } = renderWithWidth(120);
      const fullPath = tildeifyPath(defaultProps.targetDir);
      const output = lastFrame();

      // Behavior: Path is shortened with an ellipsis.
      expect(output).toContain('...');
      // Behavior: The full path is NOT displayed.
      expect(output).not.toContain(fullPath);
      // Behavior: The end of the path is visible.
      expect(output).toContain(path.basename(fullPath));
    });

    it('should display only the base name on a narrow terminal', () => {
      const { lastFrame } = renderWithWidth(NARROW_WIDTH_BREAKPOINT - 1);
      const expectedPath = path.basename(defaultProps.targetDir);
      const output = lastFrame();

      // Behavior: Only the basename is displayed.
      expect(output).toContain(expectedPath);
      // Behavior: The path is not shortened with an ellipsis.
      expect(output).not.toContain('...');
    });

    it('should use wide layout at the breakpoint', () => {
      const { lastFrame } = renderWithWidth(NARROW_WIDTH_BREAKPOINT);
      const output = lastFrame();
      // Behavior: Path is shortened (wide layout), so it's not just the basename.
      expect(output).toContain('...');
      expect(output).not.toEqual(path.basename(defaultProps.targetDir));
    });

    it('should use narrow layout just below the breakpoint', () => {
      const { lastFrame } = renderWithWidth(NARROW_WIDTH_BREAKPOINT - 1);
      const output = lastFrame();
      // Behavior: Path is just the basename (narrow layout).
      expect(output).toContain(path.basename(defaultProps.targetDir));
      expect(output).not.toContain('...');
    });
  });

  it('displays the branch name when provided', () => {
    const { lastFrame } = renderWithWidth(120);
    expect(lastFrame()).toContain(`(${defaultProps.branchName}*)`);
  });

  it('does not display the branch name when not provided', () => {
    const { lastFrame } = renderWithWidth(120, {
      ...defaultProps,
      branchName: undefined,
    });
    expect(lastFrame()).not.toContain(`(${defaultProps.branchName}*)`);
  });

  it('displays the model name and context percentage', () => {
    const { lastFrame } = renderWithWidth(120);
    expect(lastFrame()).toContain(defaultProps.model);
    expect(lastFrame()).toMatch(/\(\d+% context[\s\S]*left\)/);
  });

  describe('sandbox and trust info', () => {
    it('should display untrusted when isTrustedFolder is false', () => {
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        isTrustedFolder: false,
      });
      expect(lastFrame()).toContain('untrusted');
    });

    it('should display custom sandbox info when SANDBOX env is set', () => {
      vi.stubEnv('SANDBOX', 'gemini-cli-test-sandbox');
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        isTrustedFolder: undefined,
      });
      expect(lastFrame()).toContain('test');
      vi.unstubAllEnvs();
    });

    it('should display macOS Seatbelt info when SANDBOX is sandbox-exec', () => {
      vi.stubEnv('SANDBOX', 'sandbox-exec');
      vi.stubEnv('SEATBELT_PROFILE', 'test-profile');
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        isTrustedFolder: true,
      });
      expect(lastFrame()).toMatch(/macOS Seatbelt.*\(test-profile\)/s);
      vi.unstubAllEnvs();
    });

    it('should display "no sandbox" when SANDBOX is not set and folder is trusted', () => {
      // Clear any SANDBOX env var that might be set.
      vi.stubEnv('SANDBOX', '');
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        isTrustedFolder: true,
      });
      expect(lastFrame()).toContain('no sandbox');
      vi.unstubAllEnvs();
    });

    it('should prioritize untrusted message over sandbox info', () => {
      vi.stubEnv('SANDBOX', 'gemini-cli-test-sandbox');
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        isTrustedFolder: false,
      });
      expect(lastFrame()).toContain('untrusted');
      expect(lastFrame()).not.toMatch(/test-sandbox/s);
      vi.unstubAllEnvs();
    });
  });

  describe('footer configuration filtering (golden snapshots)', () => {
    it('renders complete footer with all sections visible (baseline)', () => {
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        hideCWD: false,
        hideSandboxStatus: false,
        hideModelInfo: false,
      });
      expect(lastFrame()).toMatchSnapshot('complete-footer-wide');
    });

    it('renders footer with all optional sections hidden (minimal footer)', () => {
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        hideCWD: true,
        hideSandboxStatus: true,
        hideModelInfo: true,
      });
      expect(lastFrame()).toMatchSnapshot('footer-minimal');
    });

    it('renders footer with only model info hidden (partial filtering)', () => {
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        hideCWD: false,
        hideSandboxStatus: false,
        hideModelInfo: true,
      });
      expect(lastFrame()).toMatchSnapshot('footer-no-model');
    });

    it('renders footer with CWD and model info hidden to test alignment (only sandbox visible)', () => {
      const { lastFrame } = renderWithWidth(120, {
        ...defaultProps,
        hideCWD: true,
        hideSandboxStatus: false,
        hideModelInfo: true,
      });
      expect(lastFrame()).toMatchSnapshot('footer-only-sandbox');
    });

    it('renders complete footer in narrow terminal (baseline narrow)', () => {
      const { lastFrame } = renderWithWidth(NARROW_WIDTH_BREAKPOINT - 1, {
        ...defaultProps,
        hideCWD: false,
        hideSandboxStatus: false,
        hideModelInfo: false,
      });
      expect(lastFrame()).toMatchSnapshot('complete-footer-narrow');
    });
  });
});
