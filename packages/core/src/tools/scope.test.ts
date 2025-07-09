/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PushScopeTool } from './pushScope.js';
import { PopScopeTool } from './popScope.js';
import { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';

describe('Scope Tools', () => {
  let mockConfig: Config;
  let mockClient: GeminiClient;

  beforeEach(() => {
    mockClient = {
      pushScope: vi.fn(),
      popScope: vi.fn(),
    } as unknown as GeminiClient;

    mockConfig = {
      getGeminiClient: () => mockClient,
    } as unknown as Config;
  });

  describe('PushScopeTool', () => {
    it('should call client.pushScope', async () => {
      const tool = new PushScopeTool(mockConfig);
      const result = await tool.execute();
      expect(mockClient.pushScope).toHaveBeenCalledOnce();
      expect(result.llmContent).toBe('New scope pushed.');
    });
  });

  describe('PopScopeTool', () => {
    it('should call client.popScope', async () => {
      const tool = new PopScopeTool(mockConfig);
      const result = await tool.execute();
      expect(mockClient.popScope).toHaveBeenCalledOnce();
      expect(result.llmContent).toBe('Scope popped.');
    });
  });
});
