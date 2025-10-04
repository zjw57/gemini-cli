/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { ResolvePathOptions } from './pathResolution.js';
import { resolveToolPath } from './pathResolution.js';
import type { Config } from '../config/config.js';
import { ToolErrorType } from '../tools/tool-error.js';
import type { WorkspaceContext } from './workspaceContext.js';
import type { FileSystemService } from '../services/fileSystemService.js';
import type { Storage } from '../config/storage.js';

// Mock dependencies
vi.mock('node:fs');
vi.mock('node:os');

describe('resolveToolPath', () => {
  let mockConfig: Config;
  let mockWorkspaceContext: WorkspaceContext;
  let mockFileSystem: FileSystemService;
  let mockStorage: Storage;

  const targetDir = '/home/user/project';
  const tempDir = '/tmp/gemini/project';
  const homeDir = '/home/user';

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup OS mock
    vi.mocked(os.homedir).mockReturnValue(homeDir);

    // Setup FS mocks (default to safe/standard behavior)
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
    vi.mocked(fs.statSync).mockImplementation(
      () =>
        ({
          isDirectory: () => false,
          isFile: () => true,
        }) as fs.Stats,
    );

    // Setup Config & Services mocks
    mockWorkspaceContext = {
      getDirectories: vi.fn().mockReturnValue([targetDir]),
      isPathWithinWorkspace: vi
        .fn()
        .mockImplementation((p) => p.startsWith(targetDir)),
    } as unknown as WorkspaceContext;

    mockFileSystem = {
      findFiles: vi.fn().mockResolvedValue([]),
    } as unknown as FileSystemService;

    mockStorage = {
      getProjectTempDir: vi.fn().mockReturnValue(tempDir),
    } as unknown as Storage;

    mockConfig = {
      getTargetDir: vi.fn().mockReturnValue(targetDir),
      getWorkspaceContext: vi.fn().mockReturnValue(mockWorkspaceContext),
      getFileSystemService: vi.fn().mockReturnValue(mockFileSystem),
      storage: mockStorage,
    } as unknown as Config;
  });

  const createOptions = (
    inputPath: string,
    overrides?: Partial<ResolvePathOptions>,
  ): ResolvePathOptions => ({
    inputPath,
    config: mockConfig,
    expectedType: 'either',
    allowNonExistent: false,
    ...overrides,
  });

  it('fails on empty path', async () => {
    const result = await resolveToolPath(createOptions('  '));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    }
  });

  it('expands tilde to homedir', async () => {
    const input = '~/config.json';
    const expected = path.join(homeDir, 'config.json');

    // Mock existence and security checks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(mockWorkspaceContext.isPathWithinWorkspace).mockReturnValue(true); // Assume home is allowed for this test

    const result = await resolveToolPath(createOptions(input));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.absolutePath).toBe(expected);
      expect(result.resolutionMethod).toBe('direct');
    }
  });

  it('resolves relative paths against CWD (targetDir)', async () => {
    const input = 'src/file.ts';
    const expected = path.join(targetDir, 'src/file.ts');

    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await resolveToolPath(createOptions(input));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.absolutePath).toBe(expected);
    }
  });

  describe('Unambiguous Smart Resolution', () => {
    it('uses findFiles if direct path does not exist', async () => {
      const input = 'unique.ts';
      const expected = path.join(targetDir, 'src/unique.ts');

      vi.mocked(fs.existsSync).mockReturnValue(false); // Direct doesn't exist
      vi.mocked(mockFileSystem.findFiles).mockResolvedValue([expected]); // Search finds one
      // Mock existence of found file for subsequent checks
      vi.mocked(fs.existsSync).mockImplementation((p) => p === expected);

      const result = await resolveToolPath(createOptions(input));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.absolutePath).toBe(expected);
        expect(result.resolutionMethod).toBe('search');
      }
    });

    it('fails if not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(mockFileSystem.findFiles).mockResolvedValue([]);

      const result = await resolveToolPath(createOptions('missing.ts'));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.FILE_NOT_FOUND);
      }
    });

    it('fails if ambiguous (multiple matches)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(mockFileSystem.findFiles).mockResolvedValue([
        path.join(targetDir, 'a/utils.ts'),
        path.join(targetDir, 'b/utils.ts'),
      ]);

      const result = await resolveToolPath(createOptions('utils.ts'));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.PATH_AMBIGUOUS);
        expect(result.error).toContain('ambiguous');
      }
    });
  });

  describe('Security Boundary Checks', () => {
    it('blocks paths outside workspace', async () => {
      const input = '/etc/passwd';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(mockWorkspaceContext.isPathWithinWorkspace).mockReturnValue(
        false,
      );

      const result = await resolveToolPath(createOptions(input));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.PATH_NOT_IN_WORKSPACE);
      }
    });

    it('allows paths in project temp dir', async () => {
      const input = path.join(tempDir, 'tempfile.txt');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(mockWorkspaceContext.isPathWithinWorkspace).mockReturnValue(
        false,
      );
      // Realpath of tempDir needed for check
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === tempDir || p === input) return p.toString();
        return p.toString();
      });

      const result = await resolveToolPath(createOptions(input));

      expect(result.success).toBe(true);
    });

    it('blocks symlinks pointing outside workspace', async () => {
      const input = path.join(targetDir, 'innocent_link');
      const realTarget = '/etc/passwd';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // The link is inside
      vi.mocked(mockWorkspaceContext.isPathWithinWorkspace).mockImplementation(
        (p) => p === input,
      );
      // But it resolves outside
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === input) return realTarget;
        return p.toString();
      });

      const result = await resolveToolPath(createOptions(input));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.PATH_NOT_IN_WORKSPACE);
      }
    });

    it('blocks write_file if parent is symlink pointing outside', async () => {
      // Case: /project/link_to_root/new_file -> /new_file
      const parentLink = path.join(targetDir, 'link_to_root');
      const input = path.join(parentLink, 'new_file');
      const realParent = '/';

      vi.mocked(fs.existsSync).mockImplementation((p) => p === parentLink); // File doesn't exist, parent does
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === parentLink) return realParent;
        // realpath on non-existent input would throw in reality,
        // but our logic handles this by checking parent's realpath.
        return p.toString();
      });

      // Workspace check fails on real parent
      vi.mocked(mockWorkspaceContext.isPathWithinWorkspace).mockImplementation(
        (p) => {
          if (p === realParent) return false;
          return p.startsWith(targetDir);
        },
      );

      const result = await resolveToolPath(
        createOptions(input, { allowNonExistent: true }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.PATH_NOT_IN_WORKSPACE);
      }
    });
  });

  describe('Type Validation', () => {
    it('fails if expected file but found directory', async () => {
      const input = path.join(targetDir, 'src');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(
        () =>
          ({
            isDirectory: () => true,
            isFile: () => false,
          }) as fs.Stats,
      );

      const result = await resolveToolPath(
        createOptions(input, { expectedType: 'file' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.TARGET_IS_DIRECTORY);
      }
    });

    it('fails if expected directory but found file', async () => {
      const input = path.join(targetDir, 'file.ts');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(
        () =>
          ({
            isDirectory: () => false,
            isFile: () => true,
          }) as fs.Stats,
      );

      const result = await resolveToolPath(
        createOptions(input, { expectedType: 'directory' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.PATH_IS_NOT_A_DIRECTORY);
      }
    });
  });

  describe('allowNonExistent (write_file scenarios)', () => {
    it('allows non-existent path if parent is valid', async () => {
      const input = path.join(targetDir, 'new_file.ts');
      const parent = path.dirname(input);

      vi.mocked(fs.existsSync).mockImplementation((p) => p === parent); // File no, parent yes
      vi.mocked(fs.statSync).mockImplementation((p) => {
        if (p === parent)
          return { isDirectory: () => true, isFile: () => false } as fs.Stats;
        throw new Error('ENOENT');
      });

      const result = await resolveToolPath(
        createOptions(input, { allowNonExistent: true }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.absolutePath).toBe(input);
      }
    });

    it('fails if parent is a file', async () => {
      const input = path.join(targetDir, 'file.ts/new_file.ts');
      const parent = path.dirname(input); // file.ts

      vi.mocked(fs.existsSync).mockImplementation((p) => p === parent);
      vi.mocked(fs.statSync).mockImplementation((p) => {
        if (p === parent)
          return { isDirectory: () => false, isFile: () => true } as fs.Stats; // Parent is file
        throw new Error('ENOENT');
      });

      const result = await resolveToolPath(
        createOptions(input, { allowNonExistent: true }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ToolErrorType.PATH_IS_NOT_A_DIRECTORY);
        expect(result.error).toContain('parent path is not a directory');
      }
    });
  });
});
