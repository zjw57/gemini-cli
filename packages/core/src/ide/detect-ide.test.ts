/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  detectIde,
  DetectedIde,
  getIdeInfo,
  type CustomIde,
} from './detect-ide.js';

describe('detectIde', () => {
  const ideProcessInfo = { pid: 123, command: 'some/path/to/code' };
  const ideProcessInfoNoCode = { pid: 123, command: 'some/path/to/fork' };

  beforeEach(() => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return the IDE from connectionConfig if provided', () => {
    const customIde: CustomIde = {
      name: 'custom-ide',
      displayName: 'Custom IDE',
    };
    expect(detectIde(ideProcessInfo, { ide: customIde })).toBe(customIde);
  });

  it('should prioritize connectionConfig over environment detection', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('REPLIT_USER', 'testuser');
    const customIde: CustomIde = {
      name: 'custom-ide',
      displayName: 'Custom IDE',
    };
    expect(detectIde(ideProcessInfo, { ide: customIde })).toBe(customIde);
    // And without it, it should detect from env
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Replit);
  });

  it('should return undefined if TERM_PROGRAM is not vscode', () => {
    vi.stubEnv('TERM_PROGRAM', '');
    expect(detectIde(ideProcessInfo)).toBeUndefined();
  });

  it('should detect Devin', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('__COG_BASHRC_SOURCED', '1');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Devin);
  });

  it('should detect Replit', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('REPLIT_USER', 'testuser');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Replit);
  });

  it('should detect Cursor', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('CURSOR_TRACE_ID', 'some-id');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Cursor);
  });

  it('should detect Codespaces', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('CODESPACES', 'true');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Codespaces);
  });

  it('should detect Cloud Shell via EDITOR_IN_CLOUD_SHELL', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('EDITOR_IN_CLOUD_SHELL', 'true');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.CloudShell);
  });

  it('should detect Cloud Shell via CLOUD_SHELL', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('CLOUD_SHELL', 'true');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.CloudShell);
  });

  it('should detect Trae', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('TERM_PRODUCT', 'Trae');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Trae);
  });

  it('should detect Firebase Studio via MONOSPACE_ENV', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('MONOSPACE_ENV', 'true');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.FirebaseStudio);
  });

  it('should detect VSCode when no other IDE is detected and command includes "code"', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('MONOSPACE_ENV', '');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.VSCode);
  });

  it('should detect VSCodeFork when no other IDE is detected and command does not include "code"', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('MONOSPACE_ENV', '');
    expect(detectIde(ideProcessInfoNoCode)).toBe(DetectedIde.VSCodeFork);
  });

  it('should prioritize other IDEs over VSCode detection', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('REPLIT_USER', 'testuser');
    expect(detectIde(ideProcessInfo)).toBe(DetectedIde.Replit);
  });
});

describe('getIdeInfo', () => {
  it('should return correct info for Devin', () => {
    expect(getIdeInfo(DetectedIde.Devin)).toEqual({
      name: DetectedIde.Devin,
      displayName: 'Devin',
    });
  });

  it('should return correct info for Replit', () => {
    expect(getIdeInfo(DetectedIde.Replit)).toEqual({
      name: DetectedIde.Replit,
      displayName: 'Replit',
    });
  });

  it('should return correct info for Cursor', () => {
    expect(getIdeInfo(DetectedIde.Cursor)).toEqual({
      name: DetectedIde.Cursor,
      displayName: 'Cursor',
    });
  });

  it('should return correct info for CloudShell', () => {
    expect(getIdeInfo(DetectedIde.CloudShell)).toEqual({
      name: DetectedIde.CloudShell,
      displayName: 'Cloud Shell',
    });
  });

  it('should return correct info for Codespaces', () => {
    expect(getIdeInfo(DetectedIde.Codespaces)).toEqual({
      name: DetectedIde.Codespaces,
      displayName: 'GitHub Codespaces',
    });
  });

  it('should return correct info for FirebaseStudio', () => {
    expect(getIdeInfo(DetectedIde.FirebaseStudio)).toEqual({
      name: DetectedIde.FirebaseStudio,
      displayName: 'Firebase Studio',
    });
  });

  it('should return correct info for Trae', () => {
    expect(getIdeInfo(DetectedIde.Trae)).toEqual({
      name: DetectedIde.Trae,
      displayName: 'Trae',
    });
  });

  it('should return correct info for VSCode', () => {
    expect(getIdeInfo(DetectedIde.VSCode)).toEqual({
      name: DetectedIde.VSCode,
      displayName: 'VS Code',
    });
  });

  it('should return correct info for VSCodeFork', () => {
    expect(getIdeInfo(DetectedIde.VSCodeFork)).toEqual({
      name: DetectedIde.VSCodeFork,
      displayName: 'IDE',
    });
  });

  it('should return the same object for a custom IDE', () => {
    const customIde: CustomIde = {
      name: 'my-ide',
      displayName: 'My Custom IDE',
    };
    expect(getIdeInfo(customIde)).toBe(customIde);
  });
});
