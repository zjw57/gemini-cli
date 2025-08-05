/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { CommandManager } from './command-manager.js';

// Mock the vscode module
vi.mock('vscode', () => ({
  window: {
    createTerminal: vi.fn(() => ({
      show: vi.fn(),
    })),
    terminals: [],
    activeTerminal: undefined,
  },
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
  })),
  Uri: {
    file: vi.fn(),
  },
  workspace: {
    fs: {
      writeFile: vi.fn(),
    },
  },
  TerminalLocation: {
    Panel: 1,
  },
  ViewColumn: {
    Beside: -2,
  },
}));

describe('CommandManager', () => {
  let commandManager: CommandManager;
  let logger: vscode.OutputChannel;

  beforeEach(() => {
    logger = {
      appendLine: vi.fn(),
    } as unknown as vscode.OutputChannel;
    commandManager = new CommandManager(logger);
    vi.clearAllMocks();
  });

  it('should create a terminal with the correct options when there is no active terminal', async () => {
    const command = 'echo "hello"';
    await commandManager.runCommand(command);

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'Gemini Tasks',
      pty: expect.any(Object),
      location: vscode.TerminalLocation.Panel,
    });
  });

  it('should create a terminal with the correct options when there is an active terminal', async () => {
    const command = 'echo "hello"';
    (vscode.window.activeTerminal as unknown) = {};

    await commandManager.runCommand(command);

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'Gemini Tasks',
      pty: expect.any(Object),
      location: { viewColumn: vscode.ViewColumn.Beside },
    });
  });
});
