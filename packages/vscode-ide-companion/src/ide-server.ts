/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  isInitializeRequest,
  type JSONRPCNotification,
} from '@modelcontextprotocol/sdk/types.js';
import { Server as HTTPServer } from 'node:http';
import * as path from 'node:path';
import { z } from 'zod';
import { DiffContentProvider } from './diff-content-provider.js';
import { DIFF_SCHEME } from './extension.js';

const MCP_SESSION_ID_HEADER = 'mcp-session-id';
const IDE_SERVER_PORT_ENV_VAR = 'GEMINI_CLI_IDE_SERVER_PORT';

function sendActiveFileChangedNotification(
  transport: StreamableHTTPServerTransport,
  logger: vscode.OutputChannel,
) {
  const editor = vscode.window.activeTextEditor;
  const filePath = editor ? editor.document.uri.fsPath : '';
  logger.appendLine(`Sending active file changed notification: ${filePath}`);
  const notification: JSONRPCNotification = {
    jsonrpc: '2.0',
    method: 'ide/activeFileChanged',
    params: { filePath },
  };
  transport.send(notification);
}

function sendDiffClosedNotification(
  transport: StreamableHTTPServerTransport,
  logger: vscode.OutputChannel,
  filePath: string,
) {
  logger.appendLine(`Sending diff closed notification for: ${filePath}`);
  const notification: JSONRPCNotification = {
    jsonrpc: '2.0',
    method: 'ide/diffClosed',
    params: { filePath },
  };
  transport.send(notification);
}

interface DiffInfo {
  originalFilePath: string;
  newContent: string;
  sessionId: string;
  rightDocUri: vscode.Uri;
}

export class IDEServer {
  private server: HTTPServer | undefined;
  private context: vscode.ExtensionContext | undefined;
  private logger: vscode.OutputChannel;
  private diffDocuments = new Map<string, DiffInfo>();
  public diffContentProvider: DiffContentProvider;

  constructor(
    logger: vscode.OutputChannel,
    diffContentProvider: DiffContentProvider,
  ) {
    this.logger = logger;
    this.diffContentProvider = diffContentProvider;
  }

  addDiffDocument(uri: vscode.Uri, diffInfo: DiffInfo) {
    this.diffDocuments.set(uri.toString(), diffInfo);
  }

  async acceptDiff(rightDocUri: vscode.Uri) {
    const diffInfo = this.diffDocuments.get(rightDocUri.toString());
    console.log(this.diffDocuments.size);
    console.log("platypus");
    for (const diffDoc of this.diffDocuments.keys()) {
      console.log("PLATYPUS");
      console.log(diffDoc);
    }
    if (!diffInfo) {
      this.logger.appendLine(`No diff info found for ${rightDocUri.toString()}`);
      return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    const fileUri = vscode.Uri.file(diffInfo.originalFilePath);
    workspaceEdit.replace(
      fileUri,
      new vscode.Range(0, 0, 99999, 0),
      diffInfo.newContent,
    );
    await vscode.workspace.applyEdit(workspaceEdit);

    const doc = await vscode.workspace.openTextDocument(fileUri);
    await doc.save();

    await this.closeDiffEditor(rightDocUri);
    vscode.window.showInformationMessage('Changes applied and saved.');
  }

  async cancelDiff(rightDocUri: vscode.Uri) {
    await this.closeDiffEditor(rightDocUri);
    vscode.window.showInformationMessage('Changes canceled.');
  }

  private async closeDiffEditor(rightDocUri: vscode.Uri) {
    const diffInfo = this.diffDocuments.get(rightDocUri.toString());
      await vscode.commands.executeCommand(
          'setContext',
          'gemini.diff.isVisible',
          false,
        );

    if (diffInfo) {
      console.log("platypus2");
      this.diffDocuments.delete(rightDocUri.toString());
      this.diffContentProvider.deleteContent(rightDocUri);
    }

    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const input = tab.input as { modified?: vscode.Uri; original?: vscode.Uri };
        if (input && input.modified?.toString() === rightDocUri.toString()) {
          await vscode.window.tabGroups.close(tab);
          return;
        }
      }
    }
  }

  async start(context: vscode.ExtensionContext) {
    this.context = context;
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};
    const sessionsWithInitialNotification = new Set<string>();

    const app = express();
    app.use(express.json());
    const mcpServer = createMcpServer(this);

    const onDidChangeActiveTextEditorDisposable =
      vscode.window.onDidChangeActiveTextEditor((_editor) => {
        for (const transport of Object.values(transports)) {
          sendActiveFileChangedNotification(transport, this.logger);
        }
      });
    context.subscriptions.push(onDidChangeActiveTextEditorDisposable);

    const onDidOpenTextDocumentDisposable =
      vscode.workspace.onDidOpenTextDocument(async (doc) => {
        if (doc.uri.scheme !== DIFF_SCHEME) {
          return;
        }
      });
    context.subscriptions.push(onDidOpenTextDocumentDisposable);

    const onDidCloseTextDocumentDisposable =
      vscode.workspace.onDidCloseTextDocument(async (doc) => {
        if (doc.uri.scheme !== DIFF_SCHEME) {
          return;
        }

        const docPath = doc.uri.toString();
        this.diffContentProvider.deleteContent(doc.uri);

        if (this.diffDocuments.has(docPath)) {
          const diffInfo = this.diffDocuments.get(docPath)!;
          console.log("platypus1");
          this.diffDocuments.delete(docPath);

          const transport = transports[diffInfo.sessionId]; // Fixed session ID lookup
          if (transport) {
            sendDiffClosedNotification(
              transport,
              this.logger,
              diffInfo.originalFilePath,
            );
          } else {
            this.logger.appendLine(
              `No transport found for session ${diffInfo.sessionId} on diff close.`,
            );
          }
        }
      });
    context.subscriptions.push(onDidCloseTextDocumentDisposable);

    app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
        | string
        | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            this.logger.appendLine(`New session initialized: ${newSessionId}`);
            transports[newSessionId] = transport;
          },
        });

        const keepAlive = setInterval(() => {
          try {
            transport.send({ jsonrpc: '2.0', method: 'ping' });
          } catch (e) {
            // If sending a ping fails, the connection is likely broken.
            // Log the error and clear the interval to prevent further attempts.
            this.logger.append(
              'Failed to send keep-alive ping, cleaning up interval.' + e,
            );
            clearInterval(keepAlive);
          }
        }, 60000); // Send ping every 60 seconds

        transport.onclose = () => {
          clearInterval(keepAlive);
          if (transport.sessionId) {
            this.logger.appendLine(`Session closed: ${transport.sessionId}`);
            sessionsWithInitialNotification.delete(transport.sessionId);
            delete transports[transport.sessionId];
          }
        };
        mcpServer.connect(transport);
      } else {
        this.logger.appendLine(
          'Bad Request: No valid session ID provided for non-initialize request.',
        );
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad Request: No valid session ID provided for non-initialize request.',
          },
          id: null,
        });
        return;
      }

      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.appendLine(`Error handling MCP request: ${errorMessage}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0' as const,
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    const handleSessionRequest = async (req: Request, res: Response) => {
      const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
        | string
        | undefined;
      if (!sessionId || !transports[sessionId]) {
        this.logger.appendLine('Invalid or missing session ID');
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      const transport = transports[sessionId];
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.appendLine(
          `Error handling session request: ${errorMessage}`,
        );
        if (!res.headersSent) {
          res.status(400).send('Bad Request');
        }
      }

      if (!sessionsWithInitialNotification.has(sessionId)) {
        sendActiveFileChangedNotification(transport, this.logger);
        sessionsWithInitialNotification.add(sessionId);
      }
    };

    app.get('/mcp', handleSessionRequest);

    this.server = app.listen(0, () => {
      const address = (this.server as HTTPServer).address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        context.environmentVariableCollection.replace(
          IDE_SERVER_PORT_ENV_VAR,
          port.toString(),
        );
        this.logger.appendLine(`IDE server listening on port ${port}`);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err?: Error) => {
          if (err) {
            this.logger.appendLine(
              `Error shutting down IDE server: ${err.message}`,
            );
            return reject(err);
          }
          this.logger.appendLine(`IDE server shut down`);
          resolve();
        });
      });
      this.server = undefined;
    }

    if (this.context) {
      this.context.environmentVariableCollection.clear();
    }
  }
}

const createMcpServer = (ideServer: IDEServer) => {
  const server = new McpServer(
    {
      name: 'gemini-cli-companion-mcp-server',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } },
  );
  server.registerTool(
    'getActiveFile',
    {
      description:
        '(IDE Tool) Get the path of the file currently active in VS Code.',
      inputSchema: {},
    },
    async () => {
      const activeEditor = vscode.window.activeTextEditor;
      const filePath = activeEditor ? activeEditor.document.uri.fsPath : '';
      if (filePath) {
        return {
          content: [{ type: 'text', text: `Active file: ${filePath}` }],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: 'No file is currently active in the editor.',
            },
          ],
        };
      }
    },
  );
  server.registerTool(
    'showDiff',
    {
      description:
        '(IDE Tool) Show a diff to create or modify a file.',
      inputSchema: z.object({
        filePath: z.string(),
        newContent: z.string().optional(),
      }).shape,
    },
    async (
      {
        filePath,
        newContent,
      }: {
        filePath: string;
        newContent?: string;
      },
    ) => {
      const fileUri = vscode.Uri.file(filePath);
      const sessionId = randomUUID();

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
          query: `sessionId=${sessionId}&rand=${Math.random()}`,
        });
        ideServer.diffContentProvider.setContent(rightDocUri, modifiedContent);
        console.log("RIGHT_DOC_URI: " + rightDocUri)
        ideServer.addDiffDocument(rightDocUri, {
          originalFilePath: filePath,
          newContent: modifiedContent,
          sessionId,
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
        );

        return {
          content: [
            {
              type: 'text',
              text: `Showing diff for ${filePath}`,
            },
          ],
        };
      } else {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.createFile(fileUri, { ignoreIfExists: true });
        workspaceEdit.insert(
          fileUri,
          new vscode.Position(0, 0),
          newContent ?? '',
        );
        await vscode.workspace.applyEdit(workspaceEdit);
        await vscode.window.showTextDocument(fileUri);

        return {
          content: [
            {
              type: 'text',
              text: `Opened new file for review: ${filePath}. You can save it to create the file.`,
            },
          ],
        };
      }
    },
  );
  return server;
};