/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import { SmartEditTool, SmartEditToolParams } from './smart_edit.js';
import { Config, ApprovalMode } from '../config/config.js';
import { GeminiClient } from '../core/client.js';
import { ToolConfirmationOutcome } from './tools.js';
import { ToolErrorType } from './tool-error.js';

// Mock critical dependencies
vi.mock('fs');
vi.mock('../config/config.js');
vi.mock('../core/client.js');
vi.mock('diff');

describe('SmartEditTool', () => {
  let smartEditTool: SmartEditTool;
  let mockConfig: vi.Mocked<Config>;
  let mockGeminiClient: vi.Mocked<GeminiClient>;
  let mockWorkspaceContext: {
    isPathWithinWorkspace: vi.Mock;
    getDirectories: vi.Mock;
  };

  const MOCK_FILE_PATH = '/workspace/test.js';
  const MOCK_FILE_CONTENT = 'console.log("hello world");';
  const MOCK_INSTRUCTION = 'change "hello world" to "hello universe"';

  beforeEach(() => {
    mockWorkspaceContext = {
      isPathWithinWorkspace: vi.fn().mockReturnValue(true),
      getDirectories: vi.fn().mockReturnValue(['/workspace']),
    };

    mockGeminiClient = {
      generateJson: vi.fn(),
    } as unknown as vi.Mocked<GeminiClient>;

    mockConfig = {
      getWorkspaceContext: vi.fn().mockReturnValue(mockWorkspaceContext),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.MANUAL),
      setApprovalMode: vi.fn(),
      getTargetDir: vi.fn().mockReturnValue('/workspace'),
    } as unknown as vi.Mocked<Config>;

    smartEditTool = new SmartEditTool(mockConfig);

    // Mock fs
    vi.mocked(fs.readFileSync).mockReturnValue(MOCK_FILE_CONTENT);
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockClear();

    // Mock diff
    vi.mocked(Diff.createPatch).mockReturnValue('mock-diff');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateToolParams', () => {
    it('should return null for valid parameters', () => {
      const params: SmartEditToolParams = {
        file_path: MOCK_FILE_PATH,
        instruction: MOCK_INSTRUCTION,
      };
      expect(smartEditTool.validateToolParams(params)).toBeNull();
    });

    it('should return an error for a relative file path', () => {
      const params: SmartEditToolParams = {
        file_path: 'test.js',
        instruction: MOCK_INSTRUCTION,
      };
      expect(smartEditTool.validateToolParams(params)).toContain(
        'File path must be absolute',
      );
    });

    it('should return an error for a file path outside the workspace', () => {
      mockWorkspaceContext.isPathWithinWorkspace.mockReturnValue(false);
      const params: SmartEditToolParams = {
        file_path: '/outside/test.js',
        instruction: MOCK_INSTRUCTION,
      };
      expect(smartEditTool.validateToolParams(params)).toContain(
        'File path must be within one of the workspace directories',
      );
    });
  });

  describe('toolLocations', () => {
    it('should return the file path from the parameters', () => {
      const params: SmartEditToolParams = {
        file_path: MOCK_FILE_PATH,
        instruction: MOCK_INSTRUCTION,
      };
      expect(smartEditTool.toolLocations(params)).toEqual([
        { path: MOCK_FILE_PATH },
      ]);
    });
  });

  describe('shouldConfirmExecute', () => {
    const params: SmartEditToolParams = {
      file_path: MOCK_FILE_PATH,
      instruction: MOCK_INSTRUCTION,
    };

    it('should return false if approval mode is AUTO_EDIT', async () => {
      mockConfig.getApprovalMode.mockReturnValue(ApprovalMode.AUTO_EDIT);
      const result = await smartEditTool.shouldConfirmExecute(
        params,
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });

    it('should return false for invalid parameters', async () => {
      const invalidParams = { ...params, file_path: 'relative/path.js' };
      const result = await smartEditTool.shouldConfirmExecute(
        invalidParams,
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });

    it('should return confirmation details for a valid edit', async () => {
      const mockEdits = {
        edits: [
          {
            search: 'console.log("hello world");',
            replace: 'console.log("hello universe");',
            explanation: 'change greeting',
          },
        ],
      };
      mockGeminiClient.generateJson.mockResolvedValue(mockEdits);

      const result = await smartEditTool.shouldConfirmExecute(
        params,
        new AbortController().signal,
      );

      expect(result).not.toBe(false);
      if (result === false) return; // type guard

      expect(result.type).toBe('edit');
      expect(result.title).toContain('Confirm Edit');
      expect(result.fileName).toBe('test.js');
      expect(result.fileDiff).toBe('mock-diff');
      expect(result.newContent).toBe('console.log("hello universe");');

      // Test onConfirm callback
      await result.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      expect(mockConfig.setApprovalMode).toHaveBeenCalledWith(
        ApprovalMode.AUTO_EDIT,
      );
    });

    it('should return false if calculateEdit returns an error', async () => {
      mockGeminiClient.generateJson.mockResolvedValue({ edits: [] }); // No edits
      const result = await smartEditTool.shouldConfirmExecute(
        params,
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    const params: SmartEditToolParams = {
      file_path: MOCK_FILE_PATH,
      instruction: MOCK_INSTRUCTION,
    };
    const mockEdits = {
      edits: [
        {
          search: 'console.log("hello world");',
          replace: 'console.log("hello universe");',
          explanation: 'change greeting',
        },
      ],
    };
    const newContent = 'console.log("hello universe");';

    it('should return an error for invalid parameters', async () => {
      const invalidParams = { ...params, file_path: 'relative/path.js' };
      const result = await smartEditTool.execute(
        invalidParams,
        new AbortController().signal,
      );
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    });

    it('should execute a valid edit using the cache from shouldConfirmExecute', async () => {
      // 1. Prime the cache with shouldConfirmExecute
      mockGeminiClient.generateJson.mockResolvedValue(mockEdits);
      await smartEditTool.shouldConfirmExecute(
        params,
        new AbortController().signal,
      );

      // 2. Execute
      const result = await smartEditTool.execute(
        params,
        new AbortController().signal,
      );

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        MOCK_FILE_PATH,
        newContent,
        'utf8',
      );
      expect(result.llmContent).toContain('Successfully modified file');
      expect(result.returnDisplay).toBeDefined();
    });

    it('should execute a valid edit without a cached value', async () => {
      mockGeminiClient.generateJson.mockResolvedValue(mockEdits);
      const result = await smartEditTool.execute(
        params,
        new AbortController().signal,
      );

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        MOCK_FILE_PATH,
        newContent,
        'utf8',
      );
      expect(result.llmContent).toContain('Successfully modified file');
    });

    it('should return an error if calculateEdit fails', async () => {
      mockGeminiClient.generateJson.mockRejectedValue(new Error('API Error'));
      const result = await smartEditTool.execute(
        params,
        new AbortController().signal,
      );
      expect(result.error?.type).toBe(ToolErrorType.EDIT_PREPARATION_FAILURE);
    });

    it('should return an error if the model generates no edits', async () => {
      mockGeminiClient.generateJson.mockResolvedValue({ edits: [] });
      const result = await smartEditTool.execute(
        params,
        new AbortController().signal,
      );
      expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_CHANGE);
    });

    it('should return an error if the search string is not found', async () => {
      const badEdits = {
        edits: [
          {
            search: 'not found',
            replace: 'wont happen',
            explanation: '...',
          },
        ],
      };
      mockGeminiClient.generateJson.mockResolvedValue(badEdits);
      const result = await smartEditTool.execute(
        params,
        new AbortController().signal,
      );
      expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_OCCURRENCE_FOUND);
    });

    it('should return an error if file writing fails', async () => {
      mockGeminiClient.generateJson.mockResolvedValue(mockEdits);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });
      const result = await smartEditTool.execute(
        params,
        new AbortController().signal,
      );
      expect(result.error?.type).toBe(ToolErrorType.FILE_WRITE_FAILURE);
    });

    it('should create parent directories if they do not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockGeminiClient.generateJson.mockResolvedValue(mockEdits);

      await smartEditTool.execute(params, new AbortController().signal);

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(MOCK_FILE_PATH), {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('_applyEdits', () => {
    // _applyEdits is private, so we test it via the public `execute` method.
    // This is already covered by the tests above, but we can add specific cases.

    it('should handle multiple non-overlapping edits correctly', async () => {
      const content = 'const a = 1;\nconst b = 2;';
      const instruction = 'change 1 to 10 and 2 to 20';
      const edits = {
        edits: [
          {
            search: 'const a = 1;',
            replace: 'const a = 10;',
            explanation: '...',
          },
          {
            search: 'const b = 2;',
            replace: 'const b = 20;',
            explanation: '...',
          },
        ],
      };
      const expectedContent = 'const a = 10;\nconst b = 20;';
      vi.mocked(fs.readFileSync).mockReturnValue(content);
      mockGeminiClient.generateJson.mockResolvedValue(edits);

      const result = await smartEditTool.execute(
        { file_path: MOCK_FILE_PATH, instruction },
        new AbortController().signal,
      );

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        MOCK_FILE_PATH,
        expectedContent,
        'utf8',
      );
      expect(result.error).toBeUndefined();
    });

    it('should return an error for overlapping edits', async () => {
      const content = 'const a = 1;';
      const instruction = 'cause overlap';
      const edits = {
        edits: [
          { search: 'const a = 1', replace: 'var a = 1', explanation: '...' },
          { search: 'a = 1;', replace: 'a = 10;', explanation: '...' },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(content);
      mockGeminiClient.generateJson.mockResolvedValue(edits);

      const result = await smartEditTool.execute(
        { file_path: MOCK_FILE_PATH, instruction },
        new AbortController().signal,
      );
      expect(result.error?.type).toBe(ToolErrorType.EDIT_APPLICATION_FAILURE);
      expect(result.error?.message).toContain('overlaps');
    });
  });

  describe('getModifyContext', () => {
    const params: SmartEditToolParams = {
      file_path: MOCK_FILE_PATH,
      instruction: MOCK_INSTRUCTION,
    };

    it('should return the correct file path', () => {
      const context = smartEditTool.getModifyContext(
        new AbortController().signal,
      );
      expect(context.getFilePath(params)).toBe(MOCK_FILE_PATH);
    });

    it('should get current content from fs', async () => {
      const context = smartEditTool.getModifyContext(
        new AbortController().signal,
      );
      const content = await context.getCurrentContent(params);
      expect(fs.readFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, 'utf8');
      expect(content).toBe(MOCK_FILE_CONTENT);
    });

    it('should get proposed content by calculating the edit', async () => {
      const mockEdits = {
        edits: [
          {
            search: 'hello world',
            replace: 'hello universe',
            explanation: '...',
          },
        ],
      };
      mockGeminiClient.generateJson.mockResolvedValue(mockEdits);
      const context = smartEditTool.getModifyContext(
        new AbortController().signal,
      );
      const proposedContent = await context.getProposedContent(params);
      expect(proposedContent).toBe('console.log("hello universe");');
    });

    it('should create updated params correctly', () => {
      const context = smartEditTool.getModifyContext(
        new AbortController().signal,
      );
      const newContent = 'const a = 1;';
      const updatedParams = context.createUpdatedParams(
        'old',
        newContent,
        params,
      );
      expect(updatedParams.instruction).toContain(newContent);
      expect(updatedParams.modified_by_user).toBe(true);
    });
  });
});
