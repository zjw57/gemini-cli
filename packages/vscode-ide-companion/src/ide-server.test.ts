/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createMcpServer } from './ide-server.js';
import { DiffContentProvider, DiffManager } from './diff-manager.js';

const registerToolsSpy = vi.fn();
const mockLanguageModelTools = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    registerTools: registerToolsSpy,
  }))
);

vi.mock('./lm-tools.js', () => ({
  LanguageModelTools: mockLanguageModelTools,
}));

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(),
  },
  lm: {
    tools: [],
    invokeTool: vi.fn(),
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    fire: vi.fn(),
    event: vi.fn(),
  })),
  commands: {
    executeCommand: vi.fn(),
  },
}));

describe('IDEServer', () => {
  let log: (message: string) => void;
  let diffManager: DiffManager;

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.fn();
    diffManager = new DiffManager(log, new DiffContentProvider());
  });

  it('Creating the mcp server registers the VsCode lm tools', async () => {
    const server = createMcpServer(diffManager, log);

    expect(mockLanguageModelTools).toHaveBeenCalledWith(log);
    expect(registerToolsSpy).toHaveBeenCalledWith(server);
  });
});
