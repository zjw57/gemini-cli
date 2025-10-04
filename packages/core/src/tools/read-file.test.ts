/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mock from 'mock-fs';
import path from 'node:path';
import { ReadFileTool, type ReadFileToolParams } from './read-file.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import type { ToolInvocation, ToolResult } from './tools.js';

vi.mock('../telemetry/loggers.js', () => ({
  logFileOperation: vi.fn(),
}));

describe('ReadFileTool', () => {
  const rootDir = '/test/root';
  const outsideDir = '/test/outside';
  const tempDir = path.join(rootDir, '.temp');
  let tool: ReadFileTool;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    // Setup mock filesystem
    mock({
      [rootDir]: {
        'test.txt': 'Absolute path content.',
        src: {
          'relative.txt': 'Relative path content.',
        },
        deep: {
          nested: {
            'unique.ts': 'Unique file content.',
          },
        },
        a: {
          'common.txt': 'c1',
        },
        b: {
          'common.txt': 'c2',
        },
        'largefile.txt': 'x'.repeat(21 * 1024 * 1024), // > 20MB
        'longlines.txt': `Short line\n${'a'.repeat(2500)}\nAnother short line`,
        'image.png': Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
        'document.pdf': Buffer.from('%PDF-1.4'),
        'binary.bin': Buffer.from([0x00, 0xff, 0x00, 0xff]),
        'image.svg': '<svg><circle cx="50" cy="50" r="40"/></svg>',
        'large.svg': '<svg>' + 'x'.repeat(1024 * 1024 + 1) + '</svg>',
        'empty.txt': '',
        'paginated.txt': Array.from(
          { length: 20 },
          (_, i) => `Line ${i + 1}`,
        ).join('\n'),
        '.geminiignore': 'foo.*\nignored/\n',
        'foo.bar': 'content',
        ignored: {
          'file.txt': 'content',
        },
        'allowed.txt': 'content',
        '.temp': {
          'temp-output.txt': 'This is temporary output content',
        },
      },
      [outsideDir]: {
        'secret.txt': 'secret',
      },
    });

    // Setup Config with real services operating on mock-fs
    const mockConfigInstance = {
      getFileService: () => new FileDiscoveryService(rootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getTargetDir: () => rootDir,
      getWorkspaceContext: () => createMockWorkspaceContext(rootDir),
      storage: {
        getProjectTempDir: () => tempDir,
      },
    } as unknown as Config;
    tool = new ReadFileTool(mockConfigInstance);
  });

  afterEach(() => {
    mock.restore();
    vi.resetAllMocks();
  });

  describe('build (validation)', () => {
    it('should return an invocation for valid params', () => {
      const params: ReadFileToolParams = {
        path: path.join(rootDir, 'test.txt'),
      };
      const result = tool.build(params);
      expect(typeof result).not.toBe('string');
    });

    it('should not throw in build for relative path', () => {
      const params: ReadFileToolParams = {
        path: 'src/relative.txt',
      };
      expect(() => tool.build(params)).not.toThrow();
    });

    it('should throw error if path is empty', () => {
      const params: ReadFileToolParams = {
        path: '',
      };
      expect(() => tool.build(params)).toThrow(
        /The 'path' parameter must be non-empty./,
      );
    });

    it('should throw error if offset is negative', () => {
      const params: ReadFileToolParams = {
        path: 'test.txt',
        offset: -1,
      };
      expect(() => tool.build(params)).toThrow(
        'Offset must be a non-negative number',
      );
    });
  });

  describe('execute (with path resolution)', () => {
    it('should read file with absolute path', async () => {
      const filePath = path.join(rootDir, 'test.txt');
      const params: ReadFileToolParams = { path: filePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      expect(await invocation.execute(abortSignal)).toEqual({
        llmContent: 'Absolute path content.',
        returnDisplay: '',
      });
    });

    it('should read file with relative path', async () => {
      const params: ReadFileToolParams = { path: 'src/relative.txt' };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      expect(await invocation.execute(abortSignal)).toEqual({
        llmContent: 'Relative path content.',
        returnDisplay: '',
      });
    });

    it('should read file with unambiguous filename', async () => {
      const params: ReadFileToolParams = { path: 'unique.ts' };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      expect(await invocation.execute(abortSignal)).toEqual({
        llmContent: 'Unique file content.',
        returnDisplay: '',
      });
    });

    it('should return error if path is ambiguous', async () => {
      const params: ReadFileToolParams = { path: 'common.txt' };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.error?.type).toBe(ToolErrorType.PATH_AMBIGUOUS);
      expect(result.error?.message).toContain('Path is ambiguous');
    });

    it('should return error if path is outside workspace', async () => {
      const outsideFile = path.join(outsideDir, 'secret.txt');
      const params: ReadFileToolParams = { path: outsideFile };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.error?.type).toBe(ToolErrorType.PATH_NOT_IN_WORKSPACE);
    });

    it('should return error if file does not exist (and not found by search)', async () => {
      const params: ReadFileToolParams = { path: 'nonexistent.txt' };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.error?.type).toBe(ToolErrorType.FILE_NOT_FOUND);
    });

    it('should return error if path is a directory', async () => {
      const params: ReadFileToolParams = { path: 'src' };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.error?.type).toBe(ToolErrorType.TARGET_IS_DIRECTORY);
    });

    it('should return error for a file that is too large', async () => {
      const filePath = path.join(rootDir, 'largefile.txt');
      const params: ReadFileToolParams = { path: filePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.error?.type).toBe(ToolErrorType.FILE_TOO_LARGE);
    });

    it('should handle text file with lines exceeding maximum length', async () => {
      const filePath = path.join(rootDir, 'longlines.txt');
      const params: ReadFileToolParams = { path: filePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'IMPORTANT: The file content has been truncated',
      );
      expect(result.returnDisplay).toContain('some lines were shortened');
    });

    it('should handle image file', async () => {
      const imagePath = path.join(rootDir, 'image.png');
      const params: ReadFileToolParams = { path: imagePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toHaveProperty('inlineData');
      expect(result.returnDisplay).toBe('Read image file: image.png');
    });

    it('should handle PDF file', async () => {
      const pdfPath = path.join(rootDir, 'document.pdf');
      const params: ReadFileToolParams = { path: pdfPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toHaveProperty('inlineData');
      expect(result.returnDisplay).toBe('Read pdf file: document.pdf');
    });

    it('should handle binary file', async () => {
      const binPath = path.join(rootDir, 'binary.bin');
      const params: ReadFileToolParams = { path: binPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Cannot display content of binary file',
      );
      expect(result.returnDisplay).toBe('Skipped binary file: binary.bin');
    });

    it('should handle SVG file as text', async () => {
      const svgPath = path.join(rootDir, 'image.svg');
      const params: ReadFileToolParams = { path: svgPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe(
        '<svg><circle cx="50" cy="50" r="40"/></svg>',
      );
      expect(result.returnDisplay).toBe('Read SVG as text: image.svg');
    });

    it('should handle large SVG file', async () => {
      const svgPath = path.join(rootDir, 'large.svg');
      const params: ReadFileToolParams = { path: svgPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Cannot display content of SVG file larger than 1MB',
      );
      expect(result.returnDisplay).toContain('Skipped large SVG file');
    });

    it('should handle empty file', async () => {
      const emptyPath = path.join(rootDir, 'empty.txt');
      const params: ReadFileToolParams = { path: emptyPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe('');
      expect(result.returnDisplay).toBe('');
    });

    it('should support offset and limit', async () => {
      const filePath = path.join(rootDir, 'paginated.txt');
      const params: ReadFileToolParams = {
        path: filePath,
        offset: 5,
        limit: 3,
      };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain('Status: Showing lines 6-8 of 20');
      expect(result.llmContent).toContain('Line 6');
    });

    it('should read files from project temp directory', async () => {
      const tempFilePath = path.join(tempDir, 'temp-output.txt');
      const params: ReadFileToolParams = { path: tempFilePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe('This is temporary output content');
    });

    describe('with .geminiignore', () => {
      it('should return error if path is ignored', async () => {
        const params: ReadFileToolParams = { path: 'foo.bar' };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);
        expect(result.error?.message).toContain('is ignored by .geminiignore');
      });

      it('should return error if file is in an ignored directory', async () => {
        const params: ReadFileToolParams = { path: 'ignored/file.txt' };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);
        expect(result.error?.message).toContain('is ignored by .geminiignore');
      });

      it('should allow reading non-ignored files', async () => {
        const params: ReadFileToolParams = { path: 'allowed.txt' };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);
        expect(result.llmContent).toBe('content');
      });
    });
  });
});
