/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CarefulModernizeTool } from './careful-modernize.js';
import { Config, ConfigParameters } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import { SubAgentScope, SubagentTerminateMode } from '../core/subagent.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';

// Mock dependencies
vi.mock('../config/config.js');
vi.mock('../core/subagent.js');

describe('CarefulModernizeTool', () => {
  let tool: CarefulModernizeTool;
  let mockConfig: Config;
  const rootDirectory = '/test/root';

  beforeEach(() => {
    const cp: ConfigParameters = {
      sessionId: 'smarttool-planner-session',
      model: DEFAULT_GEMINI_FLASH_MODEL,
      targetDir: '.',
      debugMode: false,
      cwd: process.cwd(),
    };
    mockConfig = new Config(cp);
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: 'test-auth' as AuthType,
      model: DEFAULT_GEMINI_FLASH_MODEL,
    });
    tool = new CarefulModernizeTool(rootDirectory, mockConfig);
    vi.clearAllMocks();
  });

  it('should instantiate correctly', () => {
    expect(tool).toBeInstanceOf(CarefulModernizeTool);
    expect(tool.name).toBe('careful_modernize');
  });

  describe('execute', () => {
    const validParams = { path: '/test/root/file.ts' };
    const signal = new AbortController().signal;

    it('should return a success message when the subagent achieves its goal', async () => {
      const mockRunNonInteractive = vi.fn().mockResolvedValue(undefined);
      const mockSubAgentScopeInstance = {
        runNonInteractive: mockRunNonInteractive,
        output: { terminate_reason: SubagentTerminateMode.GOAL },
      };
      vi.mocked(SubAgentScope).mockImplementation(
        () => mockSubAgentScopeInstance as unknown as SubAgentScope,
      );

      const result = await tool.execute(validParams, signal);

      expect(SubAgentScope).toHaveBeenCalled();
      expect(mockRunNonInteractive).toHaveBeenCalled();
      expect(result.llmContent).toBe('Code modernized successfully');
      expect(result.returnDisplay).toBe('Code modernized successfully');
    });

    it('should return an error message when the subagent fails to achieve its goal', async () => {
      const mockRunNonInteractive = vi.fn().mockResolvedValue(undefined);
      const mockSubAgentScopeInstance = {
        runNonInteractive: mockRunNonInteractive,
        output: { terminate_reason: 'some_other_reason' },
      };
      vi.mocked(SubAgentScope).mockImplementation(
        () => mockSubAgentScopeInstance as unknown as SubAgentScope,
      );

      const result = await tool.execute(validParams, signal);

      expect(result.llmContent).toContain(
        'An error occurred while trying to modernize code for',
      );
      expect(result.returnDisplay).toContain(
        'An error occurred while trying to modernize code for',
      );
    });

    it('should return an error message when the subagent throws an error', async () => {
      const mockRunNonInteractive = vi
        .fn()
        .mockRejectedValue(new Error('Subagent failed'));
      const mockSubAgentScopeInstance = {
        runNonInteractive: mockRunNonInteractive,
        output: {}, // Output might not be set if it throws
      };
      vi.mocked(SubAgentScope).mockImplementation(
        () => mockSubAgentScopeInstance as unknown as SubAgentScope,
      );

      const result = await tool.execute(validParams, signal);

      expect(result.llmContent).toContain(
        'An error occurred while trying to modernize code for',
      );
      expect(result.returnDisplay).toContain(
        'An error occurred while trying to modernize code for',
      );
    });

    it('should return an error if parent tool is not authenticated', async () => {
      vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
        authType: '' as AuthType,
        model: DEFAULT_GEMINI_FLASH_MODEL,
      });

      const result = await tool.execute(validParams, signal);

      expect(result.llmContent).toContain(
        'Parent tool is not properly authenticated',
      );
      expect(result.returnDisplay).toContain(
        'Parent tool is not properly authenticated',
      );
    });
  });
});
