/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { EditorStateManager, MAX_FILES } from './editor-state-manager.js';

const onDidChangeActiveTextEditorEmitter = new vscode.EventEmitter<
  vscode.TextEditor | undefined
>();
const onDidChangeTextEditorSelectionEmitter =
  new vscode.EventEmitter<vscode.TextEditorSelectionChangeEvent>();
const onDidCloseTextDocumentEmitter =
  new vscode.EventEmitter<vscode.TextDocument>();
const onDidDeleteFilesEmitter =
  new vscode.EventEmitter<vscode.FileDeleteEvent>();
const onDidRenameFilesEmitter =
  new vscode.EventEmitter<vscode.FileRenameEvent>();

vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof vscode>();
  return {
    ...actual,
    EventEmitter: vi.fn(() => {
      const listeners: Array<(e: unknown) => unknown> = [];
      return {
        event: vi.fn((listener) => {
          listeners.push(listener);
          return { dispose: vi.fn() };
        }),
        fire: vi.fn((e) => {
          listeners.forEach((listener) => listener(e));
        }),
        dispose: vi.fn(),
      };
    }),
    window: {
      ...actual.window,
      onDidChangeActiveTextEditor: vi.fn(),
      onDidChangeTextEditorSelection: vi.fn(),
      activeTextEditor: undefined,
    },
    workspace: {
      ...actual.workspace,
      onDidDeleteFiles: vi.fn(),
      onDidCloseTextDocument: vi.fn(),
      onDidRenameFiles: vi.fn(),
    },
    Uri: {
      ...actual.Uri,
      file: (path: string) => ({
        // Mock URI to return an object that has fsPath and scheme
        fsPath: path,
        scheme: 'file',
      }),
    },
    Selection: actual.Selection,
    Position: actual.Position,
  };
});

describe('EditorStateManager', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    context = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    vi.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(
      onDidChangeActiveTextEditorEmitter.event,
    );
    vi.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(
      onDidChangeTextEditorSelectionEmitter.event,
    );
    vi.mocked(vscode.workspace.onDidCloseTextDocument).mockImplementation(
      onDidCloseTextDocumentEmitter.event,
    );
    vi.mocked(vscode.workspace.onDidDeleteFiles).mockImplementation(
      onDidDeleteFilesEmitter.event,
    );
    vi.mocked(vscode.workspace.onDidRenameFiles).mockImplementation(
      onDidRenameFilesEmitter.event,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(vscode.window).activeTextEditor = undefined;
  });

  const createEditor = (filePath: string) => {
    const uri = vscode.Uri.file(filePath) as unknown as vscode.Uri; // Cast to vscode.Uri for type compatibility
    const document = {
      uri,
      getText: vi.fn(),
    } as unknown as vscode.TextDocument;
    return {
      document,
      selection: new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, 0),
      ),
    } as vscode.TextEditor;
  };

  it('initializes with the active editor', () => {
    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file1.txt');
    expect(manager.state.activeFile).toBe('/test/file1.txt'); // Check activeFile
  });

  it('adds a new file when the active editor changes', () => {
    const manager = new EditorStateManager(context);
    expect(manager.state.openFiles).toHaveLength(0);

    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    onDidChangeActiveTextEditorEmitter.fire(editor);

    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file1.txt');
    expect(manager.state.activeFile).toBe('/test/file1.txt'); // Check activeFile
  });

  it('moves an existing file to the front', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');

    const manager = new EditorStateManager(context);

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file2.txt');
    expect(manager.state.activeFile).toBe('/test/file2.txt'); // Check activeFile

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file1.txt');
    expect(manager.state.activeFile).toBe('/test/file1.txt'); // Check activeFile
    expect(manager.state.openFiles).toHaveLength(2);
  });

  it('does not exceed max files', () => {
    const manager = new EditorStateManager(context);
    for (let i = 0; i < MAX_FILES + 5; i++) {
      const editor = createEditor(`/test/file${i}.txt`);
      vi.mocked(vscode.window).activeTextEditor = editor;
      onDidChangeActiveTextEditorEmitter.fire(editor);
    }
    expect(manager.state.openFiles).toHaveLength(MAX_FILES);
    expect(manager.state.openFiles[0].filePath).toBe(
      `/test/file${MAX_FILES + 4}.txt`,
    );
    expect(manager.state.activeFile).toBe(`/test/file${MAX_FILES + 4}.txt`); // Check activeFile
  });

  it('removes a file when it is closed', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    expect(manager.state.openFiles).toHaveLength(2);
    expect(manager.state.activeFile).toBe('/test/file2.txt'); // Active file should be file2.txt

    onDidCloseTextDocumentEmitter.fire(editor1.document);
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file2.txt');
    expect(manager.state.activeFile).toBe('/test/file2.txt'); // Active file should still be file2.txt
  });

  it('updates cursor and selection on change', () => {
    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);

    const newSelection = new vscode.Selection(
      new vscode.Position(5, 5),
      new vscode.Position(5, 10),
    );
    editor.selection = newSelection;
    vi.mocked(editor.document).getText.mockReturnValue('hello');

    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor,
      selections: [newSelection],
      kind: vscode.TextEditorSelectionChangeKind.Mouse,
    });

    expect(manager.state.cursor?.line).toBe(6);
    expect(manager.state.cursor?.character).toBe(10);
    expect(manager.state.selectedText).toBe('hello');
    expect(manager.state.activeFile).toBe('/test/file1.txt'); // Still the same active file
  });

  it('truncates long selected text', () => {
    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);

    const longText = 'a'.repeat(20000);
    const newSelection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 20000),
    );
    editor.selection = newSelection;
    vi.mocked(editor.document).getText.mockReturnValue(longText);

    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor,
      selections: [newSelection],
      kind: vscode.TextEditorSelectionChangeKind.Mouse,
    });

    expect(manager.state.selectedText?.length).toBeLessThan(20000);
    expect(manager.state.selectedText).to.include('... [TRUNCATED]');
  });

  it('returns undefined for empty selection', () => {
    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);

    const newSelection = new vscode.Selection(
      new vscode.Position(5, 5),
      new vscode.Position(5, 5),
    );
    editor.selection = newSelection;
    vi.mocked(editor.document).getText.mockReturnValue('');

    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor,
      selections: [newSelection],
      kind: vscode.TextEditorSelectionChangeKind.Mouse,
    });

    expect(manager.state.selectedText).toBeUndefined();
  });

  it('removes a file when it is deleted', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    expect(manager.state.openFiles).toHaveLength(2);
    expect(manager.state.activeFile).toBe('/test/file2.txt');

    onDidDeleteFilesEmitter.fire({ files: [editor1.document.uri] });
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file2.txt');
    expect(manager.state.activeFile).toBe('/test/file2.txt');
  });

  it('updates a file when it is renamed', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file2.txt');
    expect(manager.state.activeFile).toBe('/test/file2.txt');

    const newUri = vscode.Uri.file('/test/file3.txt') as unknown as vscode.Uri; // Cast to vscode.Uri
    onDidRenameFilesEmitter.fire({
      files: [{ oldUri: editor1.document.uri, newUri }],
    });

    expect(manager.state.openFiles).toHaveLength(2);
    // The renamed file should be at the front because it's effectively "re-added"
    expect(manager.state.openFiles[0].filePath).toBe('/test/file3.txt');
    expect(manager.state.openFiles[1].filePath).toBe('/test/file2.txt');
    expect(manager.state.activeFile).toBe('/test/file3.txt');
  });
});