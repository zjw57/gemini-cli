/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDEIntegrationRegistry } from './registry.js';
import {
  IDEIntegrationFactory,
  IDEIntegration,
  IDEIntegrationConfig,
} from './types.js';

// Mock integration for testing
class MockIntegration implements IDEIntegration {
  readonly id = 'mock';
  readonly name = 'Mock IDE';
  readonly description = 'Mock integration for testing';

  constructor(private config: IDEIntegrationConfig) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getActiveFileContext() {
    return {
      filePath: '/mock/file.ts',
      cursor: { line: 10, character: 5 },
    };
  }

  async sendNotification(_message: string): Promise<void> {}
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}
}

const mockFactory: IDEIntegrationFactory = async (config) =>
  new MockIntegration(config);

describe('IDEIntegrationRegistry', () => {
  let registry: IDEIntegrationRegistry;
  let mockConfig: IDEIntegrationConfig;

  beforeEach(() => {
    registry = IDEIntegrationRegistry.getInstance();
    // Clear any existing registrations to ensure test isolation
    const registeredIds = registry.getRegisteredIds();
    for (const id of registeredIds) {
      (
        registry as unknown as {
          factories: Map<string, unknown>;
          integrations: Map<string, unknown>;
        }
      ).factories.delete(id);
      (
        registry as unknown as {
          factories: Map<string, unknown>;
          integrations: Map<string, unknown>;
        }
      ).integrations.delete(id);
    }
    mockConfig = {
      environment: { TERM_PROGRAM: 'test' },
      timeout: 5000,
      debug: false,
    };
  });

  describe('register', () => {
    it('should register a new integration factory', () => {
      registry.register('mock', mockFactory);
      expect(registry.isRegistered('mock')).toBe(true);
    });

    it('should throw error when registering duplicate ID', () => {
      registry.register('mock', mockFactory);

      expect(() => {
        registry.register('mock', mockFactory);
      }).toThrow("IDE integration with id 'mock' is already registered");
    });

    it('should allow registering multiple different integrations', () => {
      const anotherFactory: IDEIntegrationFactory = async (config) =>
        new MockIntegration(config);

      registry.register('mock1', mockFactory);
      registry.register('mock2', anotherFactory);

      expect(registry.isRegistered('mock1')).toBe(true);
      expect(registry.isRegistered('mock2')).toBe(true);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      registry.register('mock', mockFactory);
    });

    it('should create integration instance using registered factory', async () => {
      const integration = await registry.create('mock', mockConfig);

      expect(integration).toBeInstanceOf(MockIntegration);
      expect(integration.id).toBe('mock');
      expect(integration.name).toBe('Mock IDE');
    });

    it('should throw error for unregistered integration', async () => {
      await expect(registry.create('nonexistent', mockConfig)).rejects.toThrow(
        "No IDE integration registered with id 'nonexistent'",
      );
    });

    it('should pass config to factory', async () => {
      const factorySpy = vi.fn(mockFactory);
      registry.register('spy', factorySpy);

      await registry.create('spy', mockConfig);

      expect(factorySpy).toHaveBeenCalledWith(mockConfig);
    });

    it('should handle factory errors', async () => {
      const errorFactory: IDEIntegrationFactory = () => {
        throw new Error('Factory failed');
      };
      registry.register('error', errorFactory);

      await expect(registry.create('error', mockConfig)).rejects.toThrow(
        'Factory failed',
      );
    });
  });

  describe('isRegistered', () => {
    it('should return false for unregistered integration', () => {
      expect(registry.isRegistered('nonexistent')).toBe(false);
    });

    it('should return true for registered integration', () => {
      registry.register('mock', mockFactory);
      expect(registry.isRegistered('mock')).toBe(true);
    });
  });

  describe('getRegisteredIds', () => {
    it('should return empty array when no integrations registered', () => {
      expect(registry.getRegisteredIds()).toEqual([]);
    });

    it('should return array of registered IDs', () => {
      registry.register('mock1', mockFactory);
      registry.register('mock2', mockFactory);

      const ids = registry.getRegisteredIds();
      expect(ids).toContain('mock1');
      expect(ids).toContain('mock2');
      expect(ids).toHaveLength(2);
    });

    it('should return sorted array of IDs', () => {
      registry.register('zebra', mockFactory);
      registry.register('alpha', mockFactory);
      registry.register('beta', mockFactory);

      const ids = registry.getRegisteredIds();
      expect(ids).toEqual(['alpha', 'beta', 'zebra']);
    });
  });

  describe('unregister', () => {
    beforeEach(() => {
      registry.register('mock', mockFactory);
    });

    it('should remove registered integration', () => {
      expect(registry.isRegistered('mock')).toBe(true);

      registry.unregister('mock');

      expect(registry.isRegistered('mock')).toBe(false);
    });

    it('should not throw error for unregistered integration', () => {
      expect(() => {
        registry.unregister('nonexistent');
      }).not.toThrow();
    });

    it('should prevent creation after unregistering', async () => {
      registry.unregister('mock');

      await expect(registry.create('mock', mockConfig)).rejects.toThrow(
        "No IDE integration registered with id 'mock'",
      );
    });
  });

  describe('cleanup', () => {
    it('should complete without error', async () => {
      registry.register('mock', mockFactory);

      await expect(registry.cleanup()).resolves.not.toThrow();
    });

    it('should still work after cleanup', async () => {
      registry.register('mock', mockFactory);
      await registry.cleanup();

      // Registry should still be functional
      expect(registry.isRegistered('mock')).toBe(true);
      const integration = await registry.create('mock', mockConfig);
      expect(integration.id).toBe('mock');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string ID', () => {
      expect(() => {
        registry.register('', mockFactory);
      }).not.toThrow();

      expect(registry.isRegistered('')).toBe(true);
    });

    it('should handle special characters in ID', () => {
      const specialId = 'ide-with-dashes_and_underscores.and.dots';

      registry.register(specialId, mockFactory);
      expect(registry.isRegistered(specialId)).toBe(true);
    });

    it('should maintain separate factory instances', async () => {
      let callCount = 0;
      const countingFactory: IDEIntegrationFactory = async (config) => {
        callCount++;
        return new MockIntegration(config);
      };

      registry.register('counting', countingFactory);

      await registry.create('counting', mockConfig);
      await registry.create('counting', mockConfig);

      expect(callCount).toBe(2);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent registrations', () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          registry.register(`mock${i}`, mockFactory);
        }),
      );

      return expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle concurrent creations', async () => {
      registry.register('mock', mockFactory);

      const promises = Array.from({ length: 10 }, () =>
        registry.create('mock', mockConfig),
      );

      const integrations = await Promise.all(promises);
      expect(integrations).toHaveLength(10);
      integrations.forEach((integration) => {
        expect(integration.id).toBe('mock');
      });
    });
  });
});
