/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';

export const MAX_FILES = 10;
const MAX_SELECTED_TEXT_LENGTH = 16384; // 16 KiB limit

export interface OpenFile {
  filePath: string;
  timestamp: number;
}

export interface EditorState {
  openFiles: OpenFile[];
  activeFile?: string;
  cursor?: {
    line: number;
    character: number;
  };
  selectedText?: string;
}

/**
 * Keeps track of the editor state, including open files,
 * cursor position, and selected text.
 */
export class EditorStateManager {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private debounceTimer: NodeJS.Timeout | undefined;

  private openFiles: OpenFile[] = [];
  private cursor?: { line: number; character: number };
  private selectedText?: string;
  private activeFileForCursor?: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    const editorWatcher = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor) {
          this.addOrMoveToFront(editor.document.uri);
        }
        this.fireWithDebounce();
      },
    );

    const selectionWatcher = vscode.window.onDidChangeTextEditorSelection(
      (event) => {
        const editor = event.textEditor;
        if (editor && editor.document.uri.scheme === 'file') {
          this.activeFileForCursor = editor.document.uri.fsPath;
          this.cursor = editor.selection.active
            ? {
                line: editor.selection.active.line + 1,
                character: editor.selection.active.character,
              }
            : undefined;

          let selectedText: string | undefined = editor.document.getText(
            event.selections[0],
          );
          if (selectedText) {
            if (selectedText.length > MAX_SELECTED_TEXT_LENGTH) {
              selectedText =
                selectedText.substring(0, MAX_SELECTED_TEXT_LENGTH) +
                '... [TRUNCATED]';
            }
          } else {
            selectedText = undefined;
          }
          this.selectedText = selectedText;
        }
        this.fireWithDebounce();
      },
    );

    const closeWatcher = vscode.workspace.onDidCloseTextDocument((document) => {
      this.remove(document.uri);
      if (document.uri.fsPath === this.activeFileForCursor) {
        this.cursor = undefined;
        this.selectedText = undefined;
        this.activeFileForCursor = undefined;
      }
      this.fireWithDebounce();
    });

    const deleteWatcher = vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) {
        this.remove(uri);
        if (uri.fsPath === this.activeFileForCursor) {
          this.cursor = undefined;
          this.selectedText = undefined;
          this.activeFileForCursor = undefined;
        }
      }
      this.fireWithDebounce();
    });

    const renameWatcher = vscode.workspace.onDidRenameFiles((event) => {
      for (const { oldUri, newUri } of event.files) {
        this.rename(oldUri, newUri);
        if (oldUri.fsPath === this.activeFileForCursor) {
          this.activeFileForCursor = newUri.fsPath;
        }
      }
      this.fireWithDebounce();
    });

    context.subscriptions.push(
      editorWatcher,
      selectionWatcher,
      closeWatcher,
      deleteWatcher,
      renameWatcher,
    );

    if (vscode.window.activeTextEditor) {
      this.addOrMoveToFront(vscode.window.activeTextEditor.document.uri);
    }
    this.fireWithDebounce();
  }

  private addOrMoveToFront(uri: vscode.Uri) {
    if (uri.scheme !== 'file') {
      return;
    }
    const filePath = uri.fsPath;
    // Remove if it exists
    const index = this.openFiles.findIndex(
      (file) => file.filePath === filePath,
    );
    if (index !== -1) {
      this.openFiles.splice(index, 1);
    }

    // Add to the front
    this.openFiles.unshift({ filePath, timestamp: Date.now() });

    // Enforce max length
    if (this.openFiles.length > MAX_FILES) {
      this.openFiles.pop();
    }
  }

  private remove(uri: vscode.Uri) {
    if (uri.scheme !== 'file') {
      return;
    }
    const filePath = uri.fsPath;
    const index = this.openFiles.findIndex(
      (file) => file.filePath === filePath,
    );
    if (index !== -1) {
      this.openFiles.splice(index, 1);
    }
  }

  private rename(oldUri: vscode.Uri, newUri: vscode.Uri) {
    this.remove(oldUri);
    this.addOrMoveToFront(newUri);
  }

  private fireWithDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.onDidChangeEmitter.fire();
    }, 50); // 50ms
  }

  get state(): EditorState {
    const openFiles = [...this.openFiles];
    const activeFile = openFiles.length > 0 ? openFiles[0].filePath : undefined;

    return {
      openFiles,
      activeFile,
      cursor: this.cursor,
      selectedText: this.selectedText,
    };
  }
}
