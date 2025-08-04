/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { DiffContentProvider } from './diff-content-provider.js';
import { DIFF_SCHEME } from './extension.js';
import { type JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';

// Information about a diff view that is currently open.
interface DiffInfo {
  originalFilePath: string;
  newContent: string;
  rightDocUri: vscode.Uri;
}

/**
 * Manages the state and lifecycle of diff views within the IDE.
 */
export class DiffManager {
  private readonly onDidChangeEmitter =
    new vscode.EventEmitter<JSONRPCNotification>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private diffDocuments = new Map<string, DiffInfo>();

  constructor(
    private readonly logger: vscode.OutputChannel,
    private readonly diffContentProvider: DiffContentProvider,
  ) {}

  /**
   * Creates and shows a new diff view.
   */
  async showDiff(filePath: string, newContent: string) {
    const fileUri = vscode.Uri.file(filePath);

    let fileExists = true;
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      fileExists = false;
    }

    if (fileExists) {
      const modifiedContent = newContent ?? '';
      const rightDocUri = vscode.Uri.from({
        scheme: DIFF_SCHEME,
        path: filePath,
        // cache busting
        query: `rand=${Math.random()}`,
      });
      this.diffContentProvider.setContent(rightDocUri, modifiedContent);

      this.addDiffDocument(rightDocUri, {
        originalFilePath: filePath,
        newContent: modifiedContent,
        rightDocUri,
      });

      const diffTitle = `${path.basename(filePath)} ↔ Modified`;
      await vscode.commands.executeCommand(
        'setContext',
        'gemini.diff.isVisible',
        true,
      );
      await vscode.commands.executeCommand(
        'vscode.diff',
        fileUri,
        rightDocUri,
        diffTitle,
        {
          preview: false,
        },
      );
      await vscode.commands.executeCommand(
        'workbench.action.files.setActiveEditorWriteableInSession',
      );
    } else {
      // If the file doesn't exist, we create it and show it directly
      // instead of showing a diff.
      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.createFile(fileUri, { ignoreIfExists: true });
      workspaceEdit.insert(
        fileUri,
        new vscode.Position(0, 0),
        newContent ?? '',
      );
      await vscode.workspace.applyEdit(workspaceEdit);
      await vscode.window.showTextDocument(fileUri);
    }
  }

  /**
   * Closes an open diff view for a specific file.
   */
  async closeDiff(filePath: string) {
    let uriToClose: vscode.Uri | undefined;
    for (const [uriString, diffInfo] of this.diffDocuments.entries()) {
      if (diffInfo.originalFilePath === filePath) {
        uriToClose = vscode.Uri.parse(uriString);
        break;
      }
    }

    if (uriToClose) {
      const rightDoc = await vscode.workspace.openTextDocument(uriToClose);
      const modifiedContent = rightDoc.getText();
      await this.closeDiffEditor(uriToClose);
      this.onDidChangeEmitter.fire({
        jsonrpc: '2.0',
        method: 'ide/diffClosed',
        params: {
          filePath,
          content: modifiedContent,
        },
      });
      vscode.window.showInformationMessage(`Diff for ${filePath} closed.`);
    } else {
      vscode.window.showWarningMessage(`No open diff found for ${filePath}.`);
    }
  }

  /**
   * User accepts the changes in a diff view. Does not apply changes.
   */
  async acceptDiff(rightDocUri: vscode.Uri) {
    const diffInfo = this.diffDocuments.get(rightDocUri.toString());
    if (!diffInfo) {
      this.logger.appendLine(
        `No diff info found for ${rightDocUri.toString()}`,
      );
      return;
    }

    const rightDoc = await vscode.workspace.openTextDocument(rightDocUri);
    const modifiedContent = rightDoc.getText();
    await this.closeDiffEditor(rightDocUri);

    this.onDidChangeEmitter.fire({
      jsonrpc: '2.0',
      method: 'ide/diffAccepted',
      params: {
        filePath: diffInfo.originalFilePath,
        content: modifiedContent,
      },
    });
  }

  /**
   * Called when a user cancels a diff view.
   */
  async cancelDiff(rightDocUri: vscode.Uri) {
    const diffInfo = this.diffDocuments.get(rightDocUri.toString());
    if (!diffInfo) {
      this.logger.appendLine(
        `No diff info found for ${rightDocUri.toString()}`,
      );
      // Even if we don't have diff info, we should still close the editor.
      await this.closeDiffEditor(rightDocUri);
      return;
    }

    const rightDoc = await vscode.workspace.openTextDocument(rightDocUri);
    const modifiedContent = rightDoc.getText();
    await this.closeDiffEditor(rightDocUri);

    this.onDidChangeEmitter.fire({
      jsonrpc: '2.0',
      method: 'ide/diffClosed',
      params: {
        filePath: diffInfo.originalFilePath,
        content: modifiedContent,
      },
    });
  }

  private addDiffDocument(uri: vscode.Uri, diffInfo: DiffInfo) {
    this.diffDocuments.set(uri.toString(), diffInfo);
  }

  private async closeDiffEditor(rightDocUri: vscode.Uri) {
    const diffInfo = this.diffDocuments.get(rightDocUri.toString());
    await vscode.commands.executeCommand(
      'setContext',
      'gemini.diff.isVisible',
      false,
    );

    if (diffInfo) {
      this.diffDocuments.delete(rightDocUri.toString());
      this.diffContentProvider.deleteContent(rightDocUri);
    }

    // Find and close the tab corresponding to the diff view
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const input = tab.input as {
          modified?: vscode.Uri;
          original?: vscode.Uri;
        };
        if (input && input.modified?.toString() === rightDocUri.toString()) {
          await vscode.window.tabGroups.close(tab);
          return;
        }
      }
    }
  }
}
