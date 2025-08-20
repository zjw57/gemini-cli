/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createMcpServer } from './ide-server.js';
import { DiffContentProvider, DiffManager } from './diff-manager.js';

vi.mock('./lm-tools.js');

describe('IDEServer', () => {
  let log: (message: string) => void;
  let diffManager: DiffManager;

  beforeEach(() => {
    log = vi.fn();
    diffManager = new DiffManager(log, new DiffContentProvider());
  });

  it('Creating the mcp server registers the VsCode lm tools', async () => {
    const registerToolsSpy = vi.fn();
    const log = vi.fn();
    const mockLanguageModelTools = vi.fn().mockImplementation(() => ({
      registerTools: registerToolsSpy,
      log,
    }));
    vi.mock('./lm-tools.js', () => ({
      LanguageModelTools: mockLanguageModelTools,
    }));

    const server = createMcpServer(diffManager, log);

    expect(mockLanguageModelTools).toHaveBeenCalledWith(log);
    expect(registerToolsSpy).toHaveBeenCalledWith(server);
  });
});
