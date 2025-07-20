/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from '../types.js';

/**
 * Mock IDE integration for testing purposes.
 * Provides controllable behavior for all IDE integration methods.
 */
export class MockIDEIntegration implements IDEIntegration {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private _isAvailable = true;
  private _activeFileContext: ActiveFileContext | null = null;
  private _initializeError: Error | null = null;
  private _cleanupError: Error | null = null;
  private _getActiveFileError: Error | null = null;
  private _sendNotificationError: Error | null = null;
  private _fileChangeHandler?: (context: ActiveFileContext | null) => void;

  // Call tracking
  private _initializeCalled = false;
  private _cleanupCalled = false;
  private _getActiveFileCalled = false;
  private _sendNotificationCalled = false;
  private _sentNotifications: string[] = [];

  constructor(
    id: string = 'mock',
    name: string = 'Mock IDE',
    description: string = 'Mock integration for testing',
    private config: IDEIntegrationConfig = {
      environment: {},
      timeout: 5000,
      debug: false,
    },
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  // IDEIntegration interface implementation
  async isAvailable(): Promise<boolean> {
    return this._isAvailable;
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    this._getActiveFileCalled = true;

    if (this._getActiveFileError) {
      throw this._getActiveFileError;
    }

    return this._activeFileContext;
  }

  async sendNotification(message: string): Promise<void> {
    this._sendNotificationCalled = true;
    this._sentNotifications.push(message);

    if (this._sendNotificationError) {
      throw this._sendNotificationError;
    }
  }

  async initialize(): Promise<void> {
    this._initializeCalled = true;

    if (this._initializeError) {
      throw this._initializeError;
    }
  }

  async cleanup(): Promise<void> {
    this._cleanupCalled = true;

    if (this._cleanupError) {
      throw this._cleanupError;
    }
  }

  // Test control methods
  setAvailable(available: boolean): void {
    this._isAvailable = available;
  }

  setActiveFileContext(context: ActiveFileContext | null): void {
    this._activeFileContext = context;

    // Trigger file change handler if set
    if (this._fileChangeHandler) {
      this._fileChangeHandler(context);
    }
  }

  setInitializeError(error: Error | null): void {
    this._initializeError = error;
  }

  setCleanupError(error: Error | null): void {
    this._cleanupError = error;
  }

  setGetActiveFileError(error: Error | null): void {
    this._getActiveFileError = error;
  }

  setSendNotificationError(error: Error | null): void {
    this._sendNotificationError = error;
  }

  setFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this._fileChangeHandler = handler;
  }

  // Test assertion methods
  wasInitializeCalled(): boolean {
    return this._initializeCalled;
  }

  wasCleanupCalled(): boolean {
    return this._cleanupCalled;
  }

  wasGetActiveFileCalled(): boolean {
    return this._getActiveFileCalled;
  }

  wasSendNotificationCalled(): boolean {
    return this._sendNotificationCalled;
  }

  getSentNotifications(): string[] {
    return [...this._sentNotifications];
  }

  getConfig(): IDEIntegrationConfig {
    return this.config;
  }

  // Reset methods for test cleanup
  reset(): void {
    this._isAvailable = true;
    this._activeFileContext = null;
    this._initializeError = null;
    this._cleanupError = null;
    this._getActiveFileError = null;
    this._sendNotificationError = null;
    this._fileChangeHandler = undefined;

    this._initializeCalled = false;
    this._cleanupCalled = false;
    this._getActiveFileCalled = false;
    this._sendNotificationCalled = false;
    this._sentNotifications = [];
  }

  // Utility methods for common test scenarios
  static createUnavailable(id?: string): MockIDEIntegration {
    const mock = new MockIDEIntegration(id);
    mock.setAvailable(false);
    return mock;
  }

  static createWithFile(
    filePath: string,
    cursor?: { line: number; character: number },
  ): MockIDEIntegration {
    const mock = new MockIDEIntegration();
    mock.setActiveFileContext({ filePath, cursor });
    return mock;
  }

  static createWithError(
    error: Error,
    method: 'initialize' | 'cleanup' | 'getActiveFile' | 'sendNotification',
  ): MockIDEIntegration {
    const mock = new MockIDEIntegration();

    switch (method) {
      case 'initialize':
        mock.setInitializeError(error);
        break;
      case 'cleanup':
        mock.setCleanupError(error);
        break;
      case 'getActiveFile':
        mock.setGetActiveFileError(error);
        break;
      case 'sendNotification':
        mock.setSendNotificationError(error);
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }

    return mock;
  }
}

/**
 * Factory function for creating mock integrations.
 * Compatible with IDEIntegrationFactory type.
 */
export function createMockIntegrationFactory(
  id: string = 'mock',
  name: string = 'Mock IDE',
  description: string = 'Mock integration for testing',
) {
  return async (config: IDEIntegrationConfig) =>
    new MockIDEIntegration(id, name, description, config);
}

/**
 * Creates multiple mock integrations with different IDs.
 * Useful for testing integration priority and selection.
 */
export function createMultipleMockIntegrations(
  count: number,
): MockIDEIntegration[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new MockIDEIntegration(
        `mock${i + 1}`,
        `Mock IDE ${i + 1}`,
        `Mock integration ${i + 1} for testing`,
      ),
  );
}

/**
 * Mock integration that simulates VS Code behavior.
 * Includes VS Code-specific methods and behaviors.
 */
export class MockVSCodeIntegration extends MockIDEIntegration {
  private _activeFileChangeHandler?: (
    context: ActiveFileContext | null,
  ) => void;

  constructor(
    config: IDEIntegrationConfig = {
      environment: { TERM_PROGRAM: 'vscode' },
      timeout: 5000,
      debug: false,
    },
  ) {
    super('vscode', 'Visual Studio Code', 'Mock VS Code integration', config);
  }

  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this._activeFileChangeHandler = handler;
    this.setFileChangeHandler(handler);
  }

  // Simulate VS Code file change notification
  simulateFileChange(context: ActiveFileContext | null): void {
    if (this._activeFileChangeHandler) {
      this._activeFileChangeHandler(context);
    }
  }

  getMCPClient(): unknown {
    return null; // Mock MCP client
  }
}

/**
 * Mock integration that simulates JetBrains behavior.
 */
export class MockJetBrainsIntegration extends MockIDEIntegration {
  constructor(
    config: IDEIntegrationConfig = {
      environment: { IDEA_INITIAL_DIRECTORY: '/test/project' },
      timeout: 5000,
      debug: false,
    },
  ) {
    super('jetbrains', 'JetBrains IDEs', 'Mock JetBrains integration', config);
  }
}

/**
 * Mock integration that simulates Zed behavior.
 */
export class MockZedIntegration extends MockIDEIntegration {
  constructor(
    config: IDEIntegrationConfig = {
      environment: { TERM_PROGRAM: 'zed' },
      timeout: 5000,
      debug: false,
    },
  ) {
    super('zed', 'Zed', 'Mock Zed integration', config);
  }
}
