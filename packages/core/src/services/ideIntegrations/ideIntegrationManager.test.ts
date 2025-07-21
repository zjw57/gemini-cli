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

// Mock the MCP integration factory
vi.mock('./mcpIntegration.js', () => ({
  createMCPIDEIntegration: vi.fn(),
}));

import { IDEIntegrationManager } from './ideIntegrationManager.js';
import { createMCPIDEIntegration } from './mcpIntegration.js';
import {
  IDEIntegration,
  IDEIntegrationConfig,
  ActiveFileContext,
} from './types.js';
import { ideContext } from '../ideContext.js';

// Mock integration for testing
class MockMCPIntegration implements IDEIntegration {
  private _isAvailable = true;
  private _activeFileContext: ActiveFileContext | null = null;
  private _fileChangeHandler?: (context: ActiveFileContext | null) => void;

  constructor(private config: IDEIntegrationConfig) {}

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

  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this._fileChangeHandler = handler;
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

    // Reset all mocks
    vi.clearAllMocks();

    // Default mock behavior - return unavailable integration
    const defaultMock = new MockMCPIntegration(mockConfig);
    defaultMock.setAvailable(false);
    vi.mocked(createMCPIDEIntegration).mockResolvedValue(defaultMock);
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
    it('should attempt to create MCP integration during initialization', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(false); // Not available, so won't be connected
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);

      // Should attempt to create MCP integration
      expect(createMCPIDEIntegration).toHaveBeenCalledWith(mockConfig);
    });

    it('should handle no available integrations gracefully', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(false);

      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);

      expect(manager.isActive()).toBe(false);
      expect(manager.getActiveIntegration()).toBeNull();
    });

    it('should connect to available MCP integration', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);

      expect(manager.isActive()).toBe(true);
      expect(manager.getActiveIntegration()).toBe(mockIntegration);
    });

    it('should only initialize once', async () => {
      await manager.initialize(mockConfig);
      const firstCallCount = vi.mocked(createMCPIDEIntegration).mock.calls
        .length;

      await manager.initialize(mockConfig); // Second call
      const secondCallCount = vi.mocked(createMCPIDEIntegration).mock.calls
        .length;

      // Should not create integration again on second call
      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should handle integration initialization errors', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.spyOn(mockIntegration, 'initialize').mockRejectedValue(
        new Error('Init failed'),
      );
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      // Should not throw, but should not set active integration
      await manager.initialize(mockConfig);

      expect(manager.isActive()).toBe(false);
    });
  });

  describe('connectToMCP', () => {
    it('should connect to available MCP integration', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      const success = await manager.connectToMCP(mockConfig);

      expect(success).toBe(true);
      expect(manager.getActiveIntegration()).toBe(mockIntegration);
    });

    it('should return false for unavailable integration', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(false);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      const success = await manager.connectToMCP(mockConfig);

      expect(success).toBe(false);
      expect(manager.getActiveIntegration()).toBeNull();
    });

    it('should clean up previous integration before connecting to new one', async () => {
      const integration1 = new MockMCPIntegration(mockConfig);
      const integration2 = new MockMCPIntegration(mockConfig);

      integration1.setAvailable(true);
      integration2.setAvailable(true);

      const cleanup1Spy = vi.spyOn(integration1, 'cleanup');

      // First connection
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(integration1);
      await manager.connectToMCP(mockConfig);
      expect(manager.getActiveIntegration()).toBe(integration1);

      // Second connection with different integration
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(integration2);
      await manager.connectToMCP(mockConfig);

      expect(cleanup1Spy).toHaveBeenCalled();
      expect(manager.getActiveIntegration()).toBe(integration2);
    });

    it('should handle connection errors', async () => {
      vi.mocked(createMCPIDEIntegration).mockRejectedValue(
        new Error('Connection failed'),
      );

      const success = await manager.connectToMCP(mockConfig);

      expect(success).toBe(false);
      expect(manager.getActiveIntegration()).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('should return inactive status when no integration is active', async () => {
      const status = await manager.getStatus();

      expect(status).toEqual({
        active: false,
      });
    });

    it('should return active status with MCP type', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);
      const status = await manager.getStatus();

      expect(status).toEqual({
        active: true,
        integration: {
          type: 'mcp',
          available: true,
        },
      });
    });

    it('should handle availability check errors in status', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      // Make isAvailable throw an error
      vi.spyOn(mockIntegration, 'isAvailable').mockRejectedValue(
        new Error('Availability check failed'),
      );

      const status = await manager.getStatus();

      expect(status.active).toBe(true);
      expect(status.integration?.available).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should clean up active integration', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      const cleanupSpy = vi.spyOn(mockIntegration, 'cleanup');
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);
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
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(false); // Not available to avoid connection
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.initialize(mockConfig);
      await manager.cleanup();

      // Should be able to initialize again
      await expect(manager.initialize(mockConfig)).resolves.not.toThrow();
    });

    it('should handle cleanup errors gracefully', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.spyOn(mockIntegration, 'cleanup').mockRejectedValue(
        new Error('Cleanup failed'),
      );
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      // Should not throw
      await expect(manager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('isActive', () => {
    it('should return false when no integration is active', () => {
      expect(manager.isActive()).toBe(false);
    });

    it('should return true when integration is active', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      expect(manager.isActive()).toBe(true);
    });
  });

  describe('getActiveIntegration', () => {
    it('should return null when no integration is active', () => {
      expect(manager.getActiveIntegration()).toBeNull();
    });

    it('should return active integration', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      expect(manager.getActiveIntegration()).toBe(mockIntegration);
    });
  });

  describe('file context handling', () => {
    it('should set up file change handler during connection', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      const handlerSpy = vi.spyOn(
        mockIntegration,
        'setActiveFileChangeHandler',
      );
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      expect(handlerSpy).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should update IDE context when file changes', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      // Simulate file change
      const testContext: ActiveFileContext = {
        filePath: '/test/file.ts',
        cursor: { line: 10, character: 5 },
      };
      mockIntegration.setActiveFileContext(testContext);

      expect(ideContext.setActiveFileContext).toHaveBeenCalledWith({
        filePath: '/test/file.ts',
        cursor: { line: 10, character: 5 },
      });
    });

    it('should clear IDE context when file becomes null', async () => {
      const mockIntegration = new MockMCPIntegration(mockConfig);
      mockIntegration.setAvailable(true);
      vi.mocked(createMCPIDEIntegration).mockResolvedValue(mockIntegration);

      await manager.connectToMCP(mockConfig);

      // Simulate clearing file
      mockIntegration.setActiveFileContext(null);

      expect(ideContext.clearActiveFileContext).toHaveBeenCalled();
    });
  });
});
