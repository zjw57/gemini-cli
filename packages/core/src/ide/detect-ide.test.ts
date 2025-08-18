/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectIde, DetectedIde } from './detect-ide.js';
import * as processUtils from './process-utils.js';

vi.mock('./process-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process-utils.js')>();
  return {
    ...actual,
    getIdeProcessInfo: vi.fn(),
  };
});

describe('detectIde', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      command: 'code',
      expected: DetectedIde.VSCode,
    },
    {
      command: 'devin',
      expected: DetectedIde.Devin,
    },
    {
      command: 'replit',
      expected: DetectedIde.Replit,
    },
    {
      command: 'cursor',
      expected: DetectedIde.Cursor,
    },
    {
      command: 'codespaces',
      expected: DetectedIde.Codespaces,
    },
    {
      command: 'cloudshell',
      expected: DetectedIde.CloudShell,
    },
    {
      command: 'trae',
      expected: DetectedIde.Trae,
    },
    {
      command: 'firebasestudio',
      expected: DetectedIde.FirebaseStudio,
    },
    {
      command: 'monospace',
      expected: DetectedIde.FirebaseStudio,
    },
  ])('detects the IDE for $expected', async ({ command, expected }) => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    const mockedGetIdeProcessInfo = vi.mocked(processUtils.getIdeProcessInfo);
    mockedGetIdeProcessInfo.mockResolvedValue({ pid: 123, command });
    expect(await detectIde()).toBe(expected);
  });

  it('returns undefined for non-vscode', async () => {
    vi.stubEnv('TERM_PROGRAM', 'definitely-not-vscode');
    expect(await detectIde()).toBeUndefined();
  });
});
