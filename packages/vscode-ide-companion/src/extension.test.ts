/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { activate, deactivate } from './extension';
import { IDEServer } from './ide-server';
import { DiffManager } from './diff-manager';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      dispose: vi.fn(),
    }),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: {
    workspaceFolders: [],
    onDidCloseTextDocument: vi.fn(),
    registerTextDocumentContentProvider: vi.fn(),
    onDidChangeWorkspaceFolders: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
  },
  ExtensionContext: {
    subscriptions: [],
    environmentVariableCollection: {
      replace: vi.fn(),
    },
  },
}));

vi.mock('./ide-server');
vi.mock('./diff-manager');

describe('extension', () => {
  let context: vscode.ExtensionContext;
  let mockIDEServer: IDEServer;

  beforeEach(() => {
    context = {
      subscriptions: [],
      environmentVariableCollection: {
        replace: vi.fn(),
      },
      extensionUri: { fsPath: '/path/to/extension' } as vscode.Uri,
    } as any;
    mockIDEServer = new IDEServer(vi.fn(), new DiffManager({} as any, {} as any));
    (IDEServer as vi.Mock).mockImplementation(() => mockIDEServer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('activate', () => {
    it('should activate the extension', async () => {
      await activate(context);
      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
        'Gemini CLI IDE Companion',
      );
      expect(context.subscriptions.length).toBeGreaterThan(0);
      expect(mockIDEServer.start).toHaveBeenCalledWith(context);
    });

    it('should update workspace path on activation', async () => {
      (vscode.workspace.workspaceFolders as any) = [
        { uri: { fsPath: '/path/to/workspace' } },
      ];
      await activate(context);
      expect(
        context.environmentVariableCollection.replace,
      ).toHaveBeenCalledWith(
        'GEMINI_CLI_IDE_WORKSPACE_PATH',
        '/path/to/workspace',
      );
    });

    it('should register commands', async () => {
      await activate(context);
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'gemini.diff.accept',
        expect.any(Function),
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'gemini.diff.cancel',
        expect.any(Function),
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'gemini-cli.runGeminiCLI',
        expect.any(Function),
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'gemini-cli.showNotices',
        expect.any(Function),
      );
    });
  });

  describe('deactivate', () => {
    it('should deactivate the extension', async () => {
      await activate(context);
      await deactivate();
      expect(mockIDEServer.stop).toHaveBeenCalled();
    });
  });
});
