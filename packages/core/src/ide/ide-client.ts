/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  detectIde,
  DetectedIde,
  getIdeDisplayName,
} from '../ide/detect-ide.js';
import {
  ideContext,
  IdeContextNotificationSchema,
  DiffAcceptedNotificationSchema,
  DiffClosedNotificationSchema,
} from '../ide/ideContext.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) => console.debug('[DEBUG] [IDEClient]', ...args),
};

export type IDEConnectionState = {
  status: IDEConnectionStatus;
  details?: string; // User-facing
};

export enum IDEConnectionStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Connecting = 'connecting',
}

export type DiffUpdateResult =
  | {
      status: 'accepted';
      content?: string;
    }
  | {
      status: 'rejected';
      content: undefined;
    };

/**
 * Manages the connection to and interaction with the IDE server.
 */
export class IdeClient {
  client: Client | undefined = undefined;
  private state: IDEConnectionState = {
    status: IDEConnectionStatus.Disconnected,
  };
  // private diffResponses = new Map<string, (result: DiffUpdateStatus) => void>();
  private static instance: IdeClient;
  private readonly currentIde: DetectedIde | undefined;
  private readonly currentIdeDisplayName: string | undefined;
  private diffResponses = new Map<string, (result: DiffUpdateResult) => void>();

  constructor(ideMode: boolean) {
    this.currentIde = detectIde();
    if (this.currentIde) {
      this.currentIdeDisplayName = getIdeDisplayName(this.currentIde);
    }
    if (!ideMode) {
      return;
    }
    this.init().catch((err) => {
      logger.debug('Failed to initialize IdeClient:', err);
    });
  }

  static getInstance(ideMode: boolean): IdeClient {
    if (!IdeClient.instance) {
      IdeClient.instance = new IdeClient(ideMode);
    }
    return IdeClient.instance;
  }

  getCurrentIde(): DetectedIde | undefined {
    return this.currentIde;
  }

  getConnectionStatus(): IDEConnectionState {
    return this.state;
  }

  private setState(status: IDEConnectionStatus, details?: string) {
    this.state = { status, details };

    if (status === IDEConnectionStatus.Disconnected) {
      logger.debug('IDE integration is disconnected. ', details);
      ideContext.clearIdeContext();
    }
  }

  private getPortFromEnv(): string | undefined {
    const port = process.env['GEMINI_CLI_IDE_SERVER_PORT'];
    if (!port) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        'Gemini CLI Companion extension not found. Install via /ide install and restart the CLI in a fresh terminal window.',
      );
      return undefined;
    }
    return port;
  }

  private validateWorkspacePath(): boolean {
    const ideWorkspacePath = process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'];
    if (!ideWorkspacePath) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        'IDE integration requires a single workspace folder to be open in the IDE. Please ensure one folder is open and try again.',
      );
      return false;
    }
    if (ideWorkspacePath !== process.cwd()) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        `Gemini CLI is running in a different directory (${process.cwd()}) from the IDE's open workspace (${ideWorkspacePath}). Please run Gemini CLI in the same directory.`,
      );
      return false;
    }
    return true;
  }

  private registerClientHandlers() {
    if (!this.client) {
      return;
    }

    this.client.setNotificationHandler(
      IdeContextNotificationSchema,
      (notification) => {
        ideContext.setIdeContext(notification.params);
      },
    );

    this.client.setNotificationHandler(
      DiffAcceptedNotificationSchema,
      (notification) => {
        logger.debug('Received diffAccepted notification:', notification);
        const { filePath, content } = notification.params;
        const resolver = this.diffResponses.get(filePath);
        if (resolver) {
          logger.debug(
            `Found resolver for ${filePath}, resolving with accepted`,
          );
          resolver({ status: 'accepted', content });
          this.diffResponses.delete(filePath);
        } else {
          logger.debug(`No resolver found for ${filePath}`);
        }
      },
    );

    this.client.setNotificationHandler(
      DiffClosedNotificationSchema,
      (notification) => {
        logger.debug('Received diffClosed notification:', notification);
        const { filePath } = notification.params;
        const resolver = this.diffResponses.get(filePath);
        if (resolver) {
          logger.debug(
            `Found resolver for ${filePath}, resolving with rejected`,
          );
          resolver({ status: 'rejected', content: undefined });
          this.diffResponses.delete(filePath);
        } else {
          logger.debug(`No resolver found for ${filePath}`);
        }
      },
    );

    this.client.onerror = (_error) => {
      this.setState(IDEConnectionStatus.Disconnected, 'Client error.');
    };

    this.client.onclose = () => {
      this.setState(IDEConnectionStatus.Disconnected, 'Connection closed.');
    };
  }

  async reconnect(ideMode: boolean) {
    IdeClient.instance = new IdeClient(ideMode);
  }

  private async establishConnection(port: string) {
    let transport: StreamableHTTPClientTransport | undefined;
    try {
      this.client = new Client({
        name: 'streamable-http-client',
        // TODO(#3487): use the CLI version here.
        version: '1.0.0',
      });

      transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
      );

      this.registerClientHandlers();

      await this.client.connect(transport);

      this.setState(IDEConnectionStatus.Connected);
    } catch (error) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        `Failed to connect to IDE server: ${error}`,
      );
      if (transport) {
        try {
          await transport.close();
        } catch (closeError) {
          logger.debug('Failed to close transport:', closeError);
        }
      }
    }
  }

  async init(): Promise<void> {
    if (this.state.status === IDEConnectionStatus.Connected) {
      return;
    }
    if (!this.currentIde) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        'Not running in a supported IDE, skipping connection.',
      );
      return;
    }

    this.setState(IDEConnectionStatus.Connecting);

    if (!this.validateWorkspacePath()) {
      return;
    }

    const port = this.getPortFromEnv();
    if (!port) {
      return;
    }

    await this.establishConnection(port);
  }

  async openDiff(
    filePath: string,
    newContent?: string,
  ): Promise<DiffUpdateResult> {
    logger.debug(`Opening diff for ${filePath}`);
    return new Promise<DiffUpdateResult>((resolve, reject) => {
      this.diffResponses.set(filePath, resolve);
      logger.debug(`Resolver stored for ${filePath}`);
      this.client
        ?.callTool({
          name: `openDiff`,
          arguments: {
            filePath,
            newContent,
          },
        })
        .catch((err) => {
          logger.debug(`callTool for ${filePath} failed:`, err);
          reject(err);
        });
    });
  }

  async closeDiff(filePath: string): Promise<string | undefined> {
    logger.debug(`Closing diff for ${filePath}`);
    try {
      const result = await this.client?.callTool({
        name: `closeDiff`,
        arguments: {
          filePath,
        },
      });
      const content =
        result?.content &&
        Array.isArray(result.content) &&
        result.content.length > 0 &&
        result.content[0].type === 'text'
          ? result.content[0].text
          : undefined;
      return content;
    } catch (err) {
      logger.debug(`callTool for ${filePath} failed:`, err);
    }
    return;
  }

  async resolveDiffFromCli(filePath: string, outcome: 'accepted' | 'rejected') {
    logger.debug(`Resolving diff for ${filePath} from CLI with ${outcome}`);
    const content = await this.closeDiff(filePath);
    const resolver = this.diffResponses.get(filePath);
    if (resolver) {
      if (outcome === 'accepted') {
        resolver({ status: 'accepted', content });
      } else {
        resolver({ status: 'rejected', content: undefined });
      }
      this.diffResponses.delete(filePath);
    }
  }

  dispose() {
    this.client?.close();
  }

  getDetectedIdeDisplayName(): string | undefined {
    return this.currentIdeDisplayName;
  }

  setDisconnected() {
    this.setState(IDEConnectionStatus.Disconnected);
  }
}
