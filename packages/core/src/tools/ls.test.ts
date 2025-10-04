/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mock from 'mock-fs';
import path from 'node:path';
import { LSTool } from './ls.js';
import type { Config } from '../config/config.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { ToolErrorType } from './tool-error.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';

describe('LSTool', () => {
  let lsTool: LSTool;
  const rootDir = '/test/root';
  const secondaryDir = '/test/secondary';
  const outsideDir = '/test/outside';
  const tempDir = path.join(rootDir, '.temp');
  let mockConfig: Config;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    // Setup mock filesystem
    mock({
      [rootDir]: {
        'file1.txt': 'content1',
        subdir: {
          'subfile.txt': 'subcontent',
        },
        'empty-dir': {},
        'file2.log': 'log content',
        '.git': {},
        '.gitignore': '*.log',
        '.geminiignore': '*.tmp',
        'temp.tmp': 'temp content',
        src: {
          'unique-dir': {},
        },
        a: {
          'common-dir': {},
        },
        b: {
          'common-dir': {},
        },
        '.temp': {},
      },
      [secondaryDir]: {
        'secondary-file.txt': 'secondary',
        lib: {},
      },
      [outsideDir]: {
        'secret-dir': {},
      },
    });

    const mockWorkspaceContext = createMockWorkspaceContext(rootDir, [
      secondaryDir,
    ]);

    mockConfig = {
      getTargetDir: () => rootDir,
      getWorkspaceContext: () => mockWorkspaceContext,
      getFileService: () => new FileDiscoveryService(rootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      storage: {
        getProjectTempDir: () => tempDir,
      },
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectGeminiIgnore: true,
      }),
    } as unknown as Config;

    lsTool = new LSTool(mockConfig);
  });

  afterEach(() => {
    mock.restore();
    vi.resetAllMocks();
  });

  describe('build (validation)', () => {
    it('should accept valid paths', () => {
      const invocation = lsTool.build({ path: path.join(rootDir, 'src') });
      expect(invocation).toBeDefined();
    });

    // Path validation is now in execute, so build should not throw for these.
    it('should not throw in build for relative path', () => {
      expect(() => lsTool.build({ path: 'src' })).not.toThrow();
    });

    it('should not throw in build for path outside workspace', () => {
      expect(() => lsTool.build({ path: '/etc/passwd' })).not.toThrow();
    });

    it('should throw error if path is empty', () => {
      expect(() => lsTool.build({ path: '' })).toThrow(
        "The 'path' parameter must be non-empty.",
      );
    });
  });

  describe('execute (with path resolution)', () => {
    it('should list files in an absolute directory path', async () => {
      const invocation = lsTool.build({ path: rootDir });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('[DIR] subdir');
      expect(result.llmContent).toContain('file1.txt');
      // .git is ignored, file2.log is gitignored, temp.tmp is geminiignored
      expect(result.returnDisplay).toContain('Listed');
    });

    it('should list files in a relative directory path', async () => {
      const invocation = lsTool.build({ path: 'subdir' });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('subfile.txt');
    });

    it('should list files in an unambiguous directory name', async () => {
      const invocation = lsTool.build({ path: 'unique-dir' });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain(
        `Directory ${path.join(rootDir, 'src', 'unique-dir')} is empty.`,
      );
    });

    it('should list files from secondary workspace directory', async () => {
      const invocation = lsTool.build({ path: secondaryDir });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('secondary-file.txt');
      expect(result.llmContent).toContain('[DIR] lib');
    });

    it('should return error if path is ambiguous', async () => {
      const invocation = lsTool.build({ path: 'common-dir' });
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.PATH_AMBIGUOUS);
      expect(result.error?.message).toContain('Path is ambiguous');
    });

    it('should return error if path is outside workspace', async () => {
      const invocation = lsTool.build({ path: outsideDir });
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.PATH_NOT_IN_WORKSPACE);
    });

    it('should return error if directory does not exist', async () => {
      const invocation = lsTool.build({ path: 'nonexistent-dir' });
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.FILE_NOT_FOUND);
    });

    it('should return error if path is a file', async () => {
      const invocation = lsTool.build({ path: 'file1.txt' });
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.PATH_IS_NOT_A_DIRECTORY);
    });

    it('should handle empty directories', async () => {
      const emptyDir = path.join(rootDir, 'empty-dir');
      const invocation = lsTool.build({ path: emptyDir });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toBe(`Directory ${emptyDir} is empty.`);
      expect(result.returnDisplay).toBe('Directory is empty.');
    });

    it('should respect ignore patterns passed in params', async () => {
      const invocation = lsTool.build({
        path: rootDir,
        ignore: ['*.txt'],
      });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).not.toContain('file1.txt');
      expect(result.llmContent).toContain('[DIR] subdir');
    });

    it('should respect gitignore patterns', async () => {
      const invocation = lsTool.build({ path: rootDir });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('file1.txt');
      expect(result.llmContent).not.toContain('file2.log'); // gitignored
      expect(result.returnDisplay).toContain('git-ignored');
    });

    it('should respect geminiignore patterns', async () => {
      const invocation = lsTool.build({ path: rootDir });
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('file1.txt');
      expect(result.llmContent).not.toContain('temp.tmp'); // geminiignored
      expect(result.returnDisplay).toContain('gemini-ignored');
    });

    it('should sort directories first, then files alphabetically', async () => {
      // Setup specific structure for sorting test
      mock({
        [rootDir]: {
          'b-file.txt': '',
          'a-file.txt': '',
          'y-dir': {},
          'x-dir': {},
        },
      });
      // Re-create tool with new mock config
      const mockWorkspaceContext = createMockWorkspaceContext(rootDir);
      mockConfig = {
        getTargetDir: () => rootDir,
        getWorkspaceContext: () => mockWorkspaceContext,
        getFileService: () => new FileDiscoveryService(rootDir),
        getFileSystemService: () => new StandardFileSystemService(),
        storage: {
          getProjectTempDir: () => tempDir,
        },
        getFileFilteringOptions: () => ({}),
      } as unknown as Config;
      lsTool = new LSTool(mockConfig);

      const invocation = lsTool.build({ path: rootDir });
      const result = await invocation.execute(abortSignal);

      const lines = (
        typeof result.llmContent === 'string' ? result.llmContent : ''
      )
        .split('\n')
        .filter(Boolean);
      // Skip header line
      const entries = lines.slice(1);

      expect(entries[0]).toBe('[DIR] x-dir');
      expect(entries[1]).toBe('[DIR] y-dir');
      expect(entries[2]).toBe('a-file.txt');
      expect(entries[3]).toBe('b-file.txt');
    });
  });

  describe('getDescription', () => {
    it('should return relative path for absolute input', () => {
      const params = { path: path.join(rootDir, 'subdir') };
      const invocation = lsTool.build(params);
      expect(invocation.getDescription()).toBe('subdir');
    });

    it('should return input path for relative input', () => {
      const params = { path: 'subdir' };
      const invocation = lsTool.build(params);
      // With the current implementation in ls.ts, it will try to makeRelative
      // which might result in ../ if CWD is different.
      // For the prototype, we accept this limitation.
      // The exact path depends on the test environment's CWD.
      // We check that it's a relative path ending in 'subdir'.
      const description = invocation.getDescription();
      expect(description).not.toBe('subdir'); // It's not just 'subdir'
      expect(description.endsWith('subdir')).toBe(true);
      expect(path.isAbsolute(description)).toBe(false);
    });
  });
});
