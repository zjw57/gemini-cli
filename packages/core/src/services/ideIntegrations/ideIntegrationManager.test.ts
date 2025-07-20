/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the ideContext before importing anything else
vi.mock('../ideContext.js', () => ({
  ideContext: {
    setActiveFileContext: vi.fn(),
    clearActiveFileContext: vi.fn(),
  },
}));

// Mock the VS Code integration factory to return our mock
vi.mock('./vscode/index.js', () => ({
  vscodeIntegrationFactory: vi.fn(),
}));

// Mock the index.js to provide a mock registry that we can control
vi.mock('./index.js', () => {
  const mockRegistry = {
    isRegistered: vi.fn(),
    register: vi.fn(),
    create: vi.fn(),
    unregister: vi.fn(),
    cleanup: vi.fn(),
    getRegisteredIds: vi.fn(() => []),
  };
  return {
    ideIntegrationRegistry: mockRegistry,
    IDEIntegrationRegistry: vi.fn(() => mockRegistry),
    IDEIntegrationManager: vi.fn(),
  };
});

import { IDEIntegrationManager } from './ideIntegrationManager.js';
import { ideIntegrationRegistry } from './index.js';
import {
  IDEIntegration,
  IDEIntegrationConfig,
  ActiveFileContext,
} from './types.js';
import { ideContext } from '../ideContext.js';
import { vscodeIntegrationFactory } from './vscode/index.js';

// Mock integration for testing
class MockIntegration implements IDEIntegration {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private _isAvailable = true;
  private _activeFileContext: ActiveFileContext | null = null;
  private _fileChangeHandler?: (context: ActiveFileContext | null) => void;

  constructor(
    id: string,
    name: string,
    description: string,
    private config: IDEIntegrationConfig,
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  // Test helpers
  setAvailable(available: boolean) {
    this._isAvailable = available;
  }

  setActiveFileContext(context: ActiveFileContext | null) {
    this._activeFileContext = context;
    if (this._fileChangeHandler) {
      this._fileChangeHandler(context);
    }
  }

  // IDEIntegration implementation
  async isAvailable(): Promise<boolean> {
    return this._isAvailable;
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    return this._activeFileContext;
  }

  async sendNotification(_message: string): Promise<void> {}

  async initialize(): Promise<void> {}

  async cleanup(): Promise<void> {}

  // Additional method for VS Code integration compatibility
  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this._fileChangeHandler = handler;
  }
}

// Create a VSCodeMockIntegration that extends MockIntegration to properly simulate VSCode behavior
class VSCodeMockIntegration extends MockIntegration {
  constructor(config: IDEIntegrationConfig) {
    super(
      'vscode',
      'Visual Studio Code',
      'Microsoft Visual Studio Code integration via MCP over HTTP',
      config,
    );
  }
}

describe('IDEIntegrationManager', () => {
  let manager: IDEIntegrationManager;
  let mockConfig: IDEIntegrationConfig;

  beforeEach(async () => {
    // Get fresh singleton instance
    manager = IDEIntegrationManager.getInstance();

    // Clean up manager state
    await manager.cleanup();

    mockConfig = {
      environment: { TERM_PROGRAM: 'test' },
      timeout: 5000,
      debug: false,
    };

    // Reset all mocks and configure the mocked registry
    vi.clearAllMocks();

    vi.mocked(ideIntegrationRegistry.isRegistered).mockReturnValue(false);
    vi.mocked(ideIntegrationRegistry.register).mockImplementation(() => {});
    vi.mocked(ideIntegrationRegistry.create).mockImplementation(async () => {
      const defaultIntegration = new VSCodeMockIntegration(mockConfig);
      defaultIntegration.setAvailable(false);
      return defaultIntegration;
    });
    vi.mocked(ideIntegrationRegistry.cleanup).mockResolvedValue();
    vi.mocked(ideIntegrationRegistry.unregister).mockImplementation(() => {});
  });

  afterEach(async () => {
    // Clean up after each test
    await manager.cleanup();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = IDEIntegrationManager.getInstance();
      const instance2 = IDEIntegrationManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should register built-in integrations', async () => {
      await manager.initialize(mockConfig);

      // Should register VS Code integration
      expect(ideIntegrationRegistry.register).toHaveBeenCalledWith(
        'vscode',
        expect.any(Function),
      );
    });

    it('should attempt to create integrations during initialization', async () => {
      // Unit test: Verify manager tries to create integrations during initialization
      const createSpy = vi.mocked(ideIntegrationRegistry.create);
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(false); // Not available, so won't be connected
      createSpy.mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);

      // Should attempt to create VS Code integration
      expect(createSpy).toHaveBeenCalledWith('vscode', mockConfig);
    });

    it('should handle no available integrations gracefully', async () => {
      const mockIntegration = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      mockIntegration.setAvailable(false);

      // Mock registry to return unavailable integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );

      await manager.initialize(mockConfig);

      expect(manager.isActive()).toBe(false);
      expect(manager.getActiveIntegration()).toBeNull();
    });

    it('should only initialize once', async () => {
      // Unit test: Test the manager's initialization flag behavior
      await manager.initialize(mockConfig);
      const firstCallCount = vi.mocked(ideIntegrationRegistry.register).mock
        .calls.length;

      await manager.initialize(mockConfig); // Second call
      const secondCallCount = vi.mocked(ideIntegrationRegistry.register).mock
        .calls.length;

      // Should not register again on second call
      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should handle integration initialization errors', async () => {
      const mockIntegration = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      mockIntegration.setAvailable(true);
      vi.spyOn(mockIntegration, 'initialize').mockRejectedValue(
        new Error('Init failed'),
      );
      vi.mocked(vscodeIntegrationFactory).mockResolvedValue(mockIntegration);

      // Should not throw, but should not set active integration
      await manager.initialize(mockConfig);

      expect(manager.isActive()).toBe(false);
    });
  });

  describe('detectAndConnect', () => {
    it('should call registry create for VS Code during detection', async () => {
      // Unit test: Verify that detectAndConnect calls registry.create for VS Code
      const createSpy = vi.mocked(ideIntegrationRegistry.create);
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(false);
      createSpy.mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);

      // Should attempt to create VS Code integration during initialization
      expect(createSpy).toHaveBeenCalledWith('vscode', mockConfig);
    });
  });

  describe('connectToIntegration', () => {
    it('should test connection behavior via connectToIDE', async () => {
      // Unit test: Test the connection flow via connectToIDE
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      const getContextSpy = vi.spyOn(mockIntegration, 'getActiveFileContext');

      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );

      await manager.connectToIDE('vscode', mockConfig);

      // Should attempt to get initial context when connecting
      expect(getContextSpy).toHaveBeenCalled();
    });

    it('should handle context retrieval errors gracefully', async () => {
      // Unit test: Manager should not throw when context retrieval fails
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.spyOn(mockIntegration, 'getActiveFileContext').mockRejectedValue(
        new Error('Context failed'),
      );
      vi.mocked(vscodeIntegrationFactory).mockResolvedValue(mockIntegration);

      // Should not throw
      await expect(manager.initialize(mockConfig)).resolves.not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return inactive status when no integration is active', async () => {
      const status = await manager.getStatus();

      expect(status).toEqual({
        active: false,
      });
    });

    it('should return status structure correctly', async () => {
      // Unit test: Test status format without requiring full integration setup
      const status = await manager.getStatus();

      expect(status).toHaveProperty('active');
      expect(typeof status.active).toBe('boolean');
    });

    it('should handle availability check errors in status', async () => {
      // Unit test: Test that getStatus handles errors gracefully
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(true);

      // Mock the registry to return our integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );

      const success = await manager.connectToIDE('vscode', mockConfig);
      expect(success).toBe(true);

      // Make isAvailable throw an error
      vi.spyOn(mockIntegration, 'isAvailable').mockRejectedValue(
        new Error('Availability check failed'),
      );

      const status = await manager.getStatus();

      expect(status.active).toBe(true);
      expect(status.integration?.available).toBe(false);
    });
  });

  describe('connectToIDE', () => {
    beforeEach(async () => {
      await manager.cleanup(); // Ensure clean state
    });

    it('should connect to specific IDE integration', async () => {
      const mockIntegration = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      mockIntegration.setAvailable(true);

      // Mock registry to return our integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );

      const success = await manager.connectToIDE('vscode', mockConfig);

      expect(success).toBe(true);
      expect(manager.getActiveIntegration()).toBe(mockIntegration);
    });

    it('should return false for unavailable integration', async () => {
      const mockIntegration = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      mockIntegration.setAvailable(false);

      // Mock registry to return unavailable integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );

      const success = await manager.connectToIDE('vscode', mockConfig);

      expect(success).toBe(false);
      expect(manager.getActiveIntegration()).toBeNull();
    });

    it('should clean up previous integration before connecting to new one', async () => {
      const integration1 = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      const integration2 = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration v2',
        mockConfig,
      );

      integration1.setAvailable(true);
      integration2.setAvailable(true);

      const cleanup1Spy = vi.spyOn(integration1, 'cleanup');

      // First connection
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(integration1);
      await manager.connectToIDE('vscode', mockConfig);
      expect(manager.getActiveIntegration()).toBe(integration1);

      // Second connection with different integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(integration2);
      await manager.connectToIDE('vscode', mockConfig);

      expect(cleanup1Spy).toHaveBeenCalled();
      expect(manager.getActiveIntegration()).toBe(integration2);
    });

    it('should handle connection errors', async () => {
      // Mock registry to throw error
      vi.mocked(ideIntegrationRegistry.create).mockRejectedValue(
        new Error('Connection failed'),
      );

      const success = await manager.connectToIDE('vscode', mockConfig);

      expect(success).toBe(false);
      expect(manager.getActiveIntegration()).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should clean up active integration', async () => {
      // Unit test: Test cleanup via connectToIDE then cleanup
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      const cleanupSpy = vi.spyOn(mockIntegration, 'cleanup');

      // Mock the registry to return our integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );

      await manager.connectToIDE('vscode', mockConfig);
      expect(manager.isActive()).toBe(true);

      await manager.cleanup();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(manager.getActiveIntegration()).toBeNull();
      expect(manager.isActive()).toBe(false);
    });

    it('should clear IDE context', async () => {
      await manager.cleanup();

      expect(ideContext.clearActiveFileContext).toHaveBeenCalled();
    });

    it('should reset initialization state', async () => {
      const mockIntegration = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      mockIntegration.setAvailable(false); // Not available to avoid connection
      vi.mocked(vscodeIntegrationFactory).mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);
      await manager.cleanup();

      // Should be able to initialize again
      await expect(manager.initialize(mockConfig)).resolves.not.toThrow();
    });

    it('should handle cleanup errors gracefully', async () => {
      const mockIntegration = new MockIntegration(
        'vscode',
        'VS Code',
        'VS Code integration',
        mockConfig,
      );
      mockIntegration.setAvailable(true);
      vi.spyOn(mockIntegration, 'cleanup').mockRejectedValue(
        new Error('Cleanup failed'),
      );
      vi.mocked(vscodeIntegrationFactory).mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);

      // Should not throw
      await expect(manager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('isActive', () => {
    it('should return false when no integration is active', () => {
      expect(manager.isActive()).toBe(false);
    });

    it('should return true when integration is active', async () => {
      // Unit test: Use connectToIDE to establish active state
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(true);

      // Mock the registry to return our integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );
      await manager.connectToIDE('vscode', mockConfig);

      expect(manager.isActive()).toBe(true);
    });
  });

  describe('getActiveIntegration', () => {
    it('should return null when no integration is active', () => {
      expect(manager.getActiveIntegration()).toBeNull();
    });

    it('should return active integration', async () => {
      // Unit test: Use connectToIDE to establish active integration
      const mockIntegration = new VSCodeMockIntegration(mockConfig);
      mockIntegration.setAvailable(true);

      // Mock the registry to return our integration
      vi.mocked(ideIntegrationRegistry.create).mockResolvedValue(
        mockIntegration,
      );
      await manager.connectToIDE('vscode', mockConfig);

      expect(manager.getActiveIntegration()).toBe(mockIntegration);
    });
  });
});
