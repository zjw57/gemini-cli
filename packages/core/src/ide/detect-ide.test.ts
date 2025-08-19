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

const mockIdeProcessInfo = { pid: 123, command: '' };

describe('detectIde', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it.each([
    {
      env: { __COG_BASHRC_SOURCED: '1' },
      expected: DetectedIde.Devin,
    },
    {
      env: { REPLIT_USER: 'test' },
      expected: DetectedIde.Replit,
    },
    {
      env: { CURSOR_TRACE_ID: 'test' },
      expected: DetectedIde.Cursor,
    },
    {
      env: { CODESPACES: 'true' },
      expected: DetectedIde.Codespaces,
    },
    {
      env: { EDITOR_IN_CLOUD_SHELL: 'true' },
      expected: DetectedIde.CloudShell,
    },
    {
      env: { CLOUD_SHELL: 'true' },
      expected: DetectedIde.CloudShell,
    },
    {
      env: { TERM_PRODUCT: 'Trae' },
      expected: DetectedIde.Trae,
    },
    {
      env: { FIREBASE_DEPLOY_AGENT: 'true' },
      expected: DetectedIde.FirebaseStudio,
    },
    {
      env: { MONOSPACE_ENV: 'true' },
      expected: DetectedIde.FirebaseStudio,
    },
  ])('detects the IDE for $expected', async ({ env, expected }) => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    const mockedGetIdeProcessInfo = vi.mocked(processUtils.getIdeProcessInfo);
    mockedGetIdeProcessInfo.mockResolvedValue({ pid: 123, command: '' });
    for (const key in env) {
      vi.stubEnv(key, env[key as keyof typeof env]);
    }
    expect(await detectIde(mockIdeProcessInfo)).toBe(expected);
  });

  it('detects vscode', async () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    const mockedGetIdeProcessInfo = vi.mocked(processUtils.getIdeProcessInfo);
    mockedGetIdeProcessInfo.mockResolvedValue({
      pid: 123,
      command: 'code',
    });
    expect(await detectIde({ pid: 123, command: 'code' })).toBe(
      DetectedIde.VSCode,
    );
  });

  it('returns undefined for non-vscode', async () => {
    vi.stubEnv('TERM_PROGRAM', 'definitely-not-vscode');
    expect(await detectIde(mockIdeProcessInfo)).toBeUndefined();
  });
});
