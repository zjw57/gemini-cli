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

vi.mock('vscode', () => {
  const EventEmitter = vi.fn(() => {
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
  });

  interface PositionLike {
    line: number;
    character: number;
  }

  // Basic mock for Position and Selection since the test relies on the constructor.
  const Position = vi.fn((line: number, character: number) => ({
    line,
    character,
    isEqual: (other: PositionLike) =>
      other.line === line && other.character === character,
    isBefore: (other: PositionLike) =>
      line < other.line || (line === other.line && character < other.character),
    isAfter: (other: PositionLike) =>
      line > other.line || (line === other.line && character > other.character),
    translate: (lineDelta = 0, characterDelta = 0) =>
      new Position(line + lineDelta, character + characterDelta),
    with: (line: number, character: number) => new Position(line, character),
  }));

  const Selection = vi.fn((anchor, active) => ({
    anchor,
    active: active || anchor,
    isEmpty: anchor.isEqual(active),
    isSingleLine: anchor.line === active.line,
  }));

  return {
    EventEmitter,
    window: {
      onDidChangeActiveTextEditor: vi.fn(),
      onDidChangeTextEditorSelection: vi.fn(),
      activeTextEditor: undefined,
    },
    workspace: {
      onDidDeleteFiles: vi.fn(),
      onDidCloseTextDocument: vi.fn(),
      onDidRenameFiles: vi.fn(),
    },
    Uri: {
      file: (path: string) => ({
        fsPath: path,
        scheme: 'file',
      }),
      parse: (path: string) => ({
        fsPath: path,
        scheme: 'untitled',
      }),
    },
    Selection,
    Position,
    EndOfLine: { LF: 1, CRLF: 2 },
    ViewColumn: { One: 1, Two: 2, Active: -1 },
    TextEditorSelectionChangeKind: {
      Keyboard: 1,
      Mouse: 2,
      Command: 3,
    },
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

  const createEditor = (
    filePath: string,
    scheme = 'file',
    selection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0),
    ),
  ) => {
    const uri = {
      fsPath: filePath,
      scheme,
    } as vscode.Uri;
    const document = {
      uri,
      getText: vi.fn(),
      isDirty: false, // Added required property
      isUntitled: false, // Added required property
      languageId: 'typescript', // Added required property
      version: 1, // Added required property
      isClosed: false, // Added required property
      eol: vscode.EndOfLine.LF, // Added required property
      lineCount: 1, // Added required property
      save: vi.fn(), // Added required property
      offsetAt: vi.fn(), // Added required property
      positionAt: vi.fn(), // Added required property
      lineAt: vi.fn(), // Added required property
      validatePosition: vi.fn(), // Added required property
      validateRange: vi.fn(), // Added required property
      getWordRangeAtPosition: vi.fn(), // Added required property
      fileName: filePath, // Added required property
    } as unknown as vscode.TextDocument;
    return {
      document,
      selection,
      selections: [selection],
      visibleRanges: [], // Added required property
      options: {}, // Added required property
      viewColumn: vscode.ViewColumn.One, // Added required property
      edit: vi.fn(), // Added required property
      insertSnippet: vi.fn(), // Added required property
      setDecorations: vi.fn(), // Added required property
      revealRange: vi.fn(), // Added required property
      show: vi.fn(), // Added required property
      hide: vi.fn(), // Added required property
    } as vscode.TextEditor;
  };

  it('initializes with the active editor', () => {
    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file1.txt');
    expect(manager.state.activeFile).toBe('/test/file1.txt');
  });

  it('adds a new file when the active editor changes', () => {
    const manager = new EditorStateManager(context);
    expect(manager.state.openFiles).toHaveLength(0);

    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    onDidChangeActiveTextEditorEmitter.fire(editor);

    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file1.txt');
    expect(manager.state.activeFile).toBe('/test/file1.txt');
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
    expect(manager.state.activeFile).toBe('/test/file2.txt');

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file1.txt');
    expect(manager.state.activeFile).toBe('/test/file1.txt');
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
    expect(manager.state.activeFile).toBe(`/test/file${MAX_FILES + 4}.txt`);
  });

  it('removes a file when it is closed and clears cursor info if it was active', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    // Set up initial state with file1 and file2, file1 has cursor info
    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    const selection = new vscode.Selection(
      new vscode.Position(1, 1),
      new vscode.Position(1, 5),
    );
    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor1,
      selections: [selection],
      kind: undefined,
    });
    expect(manager.state.cursor).toBeDefined();

    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    expect(manager.state.openFiles).toHaveLength(2);
    expect(manager.state.activeFile).toBe('/test/file2.txt');

    // Close file1, cursor info should be cleared
    onDidCloseTextDocumentEmitter.fire(editor1.document);
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file2.txt');
    expect(manager.state.cursor).toBeUndefined();
    expect(manager.state.selectedText).toBeUndefined();
  });

  it('updates cursor and selection on change and persists it', () => {
    const newSelection = new vscode.Selection(
      new vscode.Position(5, 5),
      new vscode.Position(5, 10),
    );
    const editor = createEditor('/test/file1.txt', 'file', newSelection);
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);
    onDidChangeActiveTextEditorEmitter.fire(editor);

    vi.mocked(editor.document.getText).mockReturnValue('hello');

    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor,
      selections: [newSelection],
      kind: vscode.TextEditorSelectionChangeKind.Mouse,
    });

    expect(manager.state.cursor?.line).toBe(6);
    expect(manager.state.cursor?.character).toBe(10);
    expect(manager.state.selectedText).toBe('hello');
    expect(manager.state.activeFile).toBe('/test/file1.txt');

    // Change to a non-file editor
    const nonFileEditor = createEditor('output:1', 'output');
    vi.mocked(vscode.window).activeTextEditor = nonFileEditor;
    onDidChangeActiveTextEditorEmitter.fire(nonFileEditor);

    // Cursor and selection info should persist
    expect(manager.state.cursor?.line).toBe(6);
    expect(manager.state.cursor?.character).toBe(10);
    expect(manager.state.selectedText).toBe('hello');
    // Active file is still the last *file* URI
    expect(manager.state.activeFile).toBe('/test/file1.txt');
  });

  it('truncates long selected text', () => {
    const editor = createEditor('/test/file1.txt');
    vi.mocked(vscode.window).activeTextEditor = editor;
    const manager = new EditorStateManager(context);
    onDidChangeActiveTextEditorEmitter.fire(editor);

    const longText = 'a'.repeat(20000);
    const newSelection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 20000),
    );
    vi.mocked(editor.document.getText).mockReturnValue(longText);

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
    onDidChangeActiveTextEditorEmitter.fire(editor);

    const newSelection = new vscode.Selection(
      new vscode.Position(5, 5),
      new vscode.Position(5, 5),
    );
    vi.mocked(editor.document.getText).mockReturnValue('');

    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor,
      selections: [newSelection],
      kind: vscode.TextEditorSelectionChangeKind.Mouse,
    });

    expect(manager.state.selectedText).toBeUndefined();
  });

  it('removes a file when it is deleted and clears cursor info', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    const selection = new vscode.Selection(
      new vscode.Position(1, 1),
      new vscode.Position(1, 5),
    );
    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor1,
      selections: [selection],
      kind: undefined,
    });
    expect(manager.state.cursor).toBeDefined();

    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    expect(manager.state.openFiles).toHaveLength(2);

    onDidDeleteFilesEmitter.fire({ files: [editor1.document.uri] });
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.openFiles[0].filePath).toBe('/test/file2.txt');
    expect(manager.state.cursor).toBeUndefined();
    expect(manager.state.selectedText).toBeUndefined();
  });

  it('updates a file when it is renamed and preserves cursor info', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    vi.mocked(vscode.window).activeTextEditor = editor1;
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    const selection = new vscode.Selection(
      new vscode.Position(1, 1),
      new vscode.Position(1, 5),
    );
    vi.mocked(editor1.document.getText).mockReturnValue('text');
    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor1,
      selections: [selection],
      kind: undefined,
    });
    expect(manager.state.cursor).toBeDefined();
    expect(manager.state.selectedText).toBe('text');

    vi.mocked(vscode.window).activeTextEditor = editor2;
    onDidChangeActiveTextEditorEmitter.fire(editor2);

    const newUri = vscode.Uri.file('/test/file3.txt') as vscode.Uri;
    onDidRenameFilesEmitter.fire({
      files: [{ oldUri: editor1.document.uri, newUri }],
    });

    expect(manager.state.openFiles).toHaveLength(2);
    // The renamed file should be at the front because it's effectively "re-added"
    expect(manager.state.openFiles[0].filePath).toBe('/test/file3.txt');
    expect(manager.state.openFiles[1].filePath).toBe('/test/file2.txt');
    expect(manager.state.activeFile).toBe('/test/file3.txt');
    // Cursor info should be preserved
    expect(manager.state.cursor).toBeDefined();
    expect(manager.state.selectedText).toBe('text');
  });

  it('debounces change events', () => {
    vi.useFakeTimers();
    const manager = new EditorStateManager(context);
    const spy = vi.fn();
    manager.onDidChange(spy);

    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');

    onDidChangeActiveTextEditorEmitter.fire(editor1);
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    onDidChangeActiveTextEditorEmitter.fire(editor1);

    expect(spy).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('handles multiple editors being open and closing one', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const editor3 = createEditor('/test/file3.txt');
    const manager = new EditorStateManager(context);

    // Open 3 files, file3 is active
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    onDidChangeActiveTextEditorEmitter.fire(editor3);

    expect(manager.state.openFiles.map((f) => f.filePath)).toEqual([
      '/test/file3.txt',
      '/test/file2.txt',
      '/test/file1.txt',
    ]);
    expect(manager.state.activeFile).toBe('/test/file3.txt');

    // Close file2 (not the active one)
    onDidCloseTextDocumentEmitter.fire(editor2.document);

    expect(manager.state.openFiles.map((f) => f.filePath)).toEqual([
      '/test/file3.txt',
      '/test/file1.txt',
    ]);
    expect(manager.state.activeFile).toBe('/test/file3.txt');

    // Close file3 (the active one)
    onDidCloseTextDocumentEmitter.fire(editor3.document);
    expect(manager.state.openFiles.map((f) => f.filePath)).toEqual([
      '/test/file1.txt',
    ]);
    // Active file should now be the next in the list
    expect(manager.state.activeFile).toBe('/test/file1.txt');
  });

  it('ignores editors with non-file schemes', () => {
    const manager = new EditorStateManager(context);
    const fileEditor = createEditor('/test/file1.txt');
    const untitledEditor = createEditor('Untitled-1', 'untitled');

    onDidChangeActiveTextEditorEmitter.fire(fileEditor);
    expect(manager.state.openFiles).toHaveLength(1);
    expect(manager.state.activeFile).toBe('/test/file1.txt');

    onDidChangeActiveTextEditorEmitter.fire(untitledEditor);
    expect(manager.state.openFiles).toHaveLength(1); // Should not have added the untitled editor
    expect(manager.state.activeFile).toBe('/test/file1.txt');

    onDidCloseTextDocumentEmitter.fire(untitledEditor.document);
    expect(manager.state.openFiles).toHaveLength(1); // Should not have changed anything
  });

  it('clears cursor info when active file changes to one with no selection', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const manager = new EditorStateManager(context);

    // Set selection in file1
    onDidChangeActiveTextEditorEmitter.fire(editor1);
    const selection = new vscode.Selection(
      new vscode.Position(1, 1),
      new vscode.Position(1, 5),
    );
    vi.mocked(editor1.document.getText).mockReturnValue('text');
    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor1,
      selections: [selection],
      kind: undefined,
    });
    expect(manager.state.cursor).toBeDefined();
    expect(manager.state.selectedText).toBe('text');

    // Change to file2, which has no selection
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    const emptySelection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0),
    );
    vi.mocked(editor2.document.getText).mockReturnValue('');
    onDidChangeTextEditorSelectionEmitter.fire({
      textEditor: editor2,
      selections: [emptySelection],
      kind: undefined,
    });

    expect(manager.state.activeFile).toBe('/test/file2.txt');
    expect(manager.state.cursor?.line).toBe(1); // Line is 1-based
    expect(manager.state.cursor?.character).toBe(0);
    expect(manager.state.selectedText).toBeUndefined();
  });

  it('initializes with no active editor', () => {
    vi.mocked(vscode.window).activeTextEditor = undefined;
    const manager = new EditorStateManager(context);
    expect(manager.state.openFiles).toHaveLength(0);
    expect(manager.state.activeFile).toBeUndefined();
    expect(manager.state.cursor).toBeUndefined();
    expect(manager.state.selectedText).toBeUndefined();
  });

  it('handles deletion of multiple files', () => {
    const editor1 = createEditor('/test/file1.txt');
    const editor2 = createEditor('/test/file2.txt');
    const editor3 = createEditor('/test/file3.txt');
    const manager = new EditorStateManager(context);

    onDidChangeActiveTextEditorEmitter.fire(editor1);
    onDidChangeActiveTextEditorEmitter.fire(editor2);
    onDidChangeActiveTextEditorEmitter.fire(editor3);
    expect(manager.state.openFiles).toHaveLength(3);

    onDidDeleteFilesEmitter.fire({
      files: [editor1.document.uri, editor3.document.uri],
    });

    expect(manager.state.openFiles.map((f) => f.filePath)).toEqual([
      '/test/file2.txt',
    ]);
    expect(manager.state.openFiles).toHaveLength(1);
  });
});
