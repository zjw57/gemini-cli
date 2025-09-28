/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  getEnvironmentContext,
  getDirectoryContextString,
} from './environmentContext.js';
import type { Config } from '../config/config.js';
import { getFolderStructure } from './getFolderStructure.js';
import { GlobTool } from '../tools/glob.js';
import { ReadFileTool } from '../tools/read-file.js';

vi.mock('../config/config.js');
vi.mock('./getFolderStructure.js', () => ({
  getFolderStructure: vi.fn(),
}));

describe('getDirectoryContextString', () => {
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    mockConfig = {
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/test/dir']),
      }),
      getFileService: vi.fn(),
    };
    vi.mocked(getFolderStructure).mockResolvedValue('Mock Folder Structure');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return context string for a single directory', async () => {
    const contextString = await getDirectoryContextString(mockConfig as Config);
    expect(contextString).toContain(
      "I'm currently working in the directory: /test/dir",
    );
    expect(contextString).toContain(
      'Here is the folder structure of the current working directories:\n\nMock Folder Structure',
    );
  });

  it('should return context string for multiple directories', async () => {
    (
      vi.mocked(mockConfig.getWorkspaceContext!)().getDirectories as Mock
    ).mockReturnValue(['/test/dir1', '/test/dir2']);
    vi.mocked(getFolderStructure)
      .mockResolvedValueOnce('Structure 1')
      .mockResolvedValueOnce('Structure 2');

    const contextString = await getDirectoryContextString(mockConfig as Config);
    expect(contextString).toContain(
      "I'm currently working in the following directories:\n  - /test/dir1\n  - /test/dir2",
    );
    expect(contextString).toContain(
      'Here is the folder structure of the current working directories:\n\nStructure 1\nStructure 2',
    );
  });
});

describe('getEnvironmentContext', () => {
  let mockConfig: Partial<Config>;
  let mockToolRegistry: { getTool: Mock };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-08-05T12:00:00Z'));

    mockToolRegistry = {
      getTool: vi.fn(),
    };

    mockConfig = {
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/test/dir']),
      }),
      getFileService: vi.fn(),
      getFullContext: vi.fn().mockReturnValue(false),
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
    };

    vi.mocked(getFolderStructure).mockResolvedValue('Mock Folder Structure');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('should return basic environment context for a single directory', async () => {
    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1);
    const context = parts[0].text;

    expect(context).toContain("Today's date is");
    expect(context).toContain("(formatted according to the user's locale)");
    expect(context).toContain(`My operating system is: ${process.platform}`);
    expect(context).toContain(
      "I'm currently working in the directory: /test/dir",
    );
    expect(context).toContain(
      'Here is the folder structure of the current working directories:\n\nMock Folder Structure',
    );
    expect(getFolderStructure).toHaveBeenCalledWith('/test/dir', {
      fileService: undefined,
    });
  });

  it('should return basic environment context for multiple directories', async () => {
    (
      vi.mocked(mockConfig.getWorkspaceContext!)().getDirectories as Mock
    ).mockReturnValue(['/test/dir1', '/test/dir2']);
    vi.mocked(getFolderStructure)
      .mockResolvedValueOnce('Structure 1')
      .mockResolvedValueOnce('Structure 2');

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1);
    const context = parts[0].text;

    expect(context).toContain(
      "I'm currently working in the following directories:\n  - /test/dir1\n  - /test/dir2",
    );
    expect(context).toContain(
      'Here is the folder structure of the current working directories:\n\nStructure 1\nStructure 2',
    );
    expect(getFolderStructure).toHaveBeenCalledTimes(2);
  });

  it('should include full file context when getFullContext is true', async () => {
    mockConfig.getFullContext = vi.fn().mockReturnValue(true);

    const mockGlobTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          llmContent: 'Found 2 files:\n/path/to/file1.txt\n/path/to/file2.txt',
        }),
      }),
    };

    const mockReadFileTool = {
      build: vi.fn().mockImplementation((args) => ({
        execute: vi.fn().mockResolvedValue({
          llmContent: `Content of ${args.absolute_path}`,
        }),
      })),
    };

    mockToolRegistry.getTool.mockImplementation((toolName) => {
      if (toolName === GlobTool.Name) return mockGlobTool;
      if (toolName === ReadFileTool.Name) return mockReadFileTool;
      return null;
    });

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(2);
    const expectedContent = `
--- Full File Context ---
--- /path/to/file1.txt ---
Content of /path/to/file1.txt

--- /path/to/file2.txt ---
Content of /path/to/file2.txt

--- End of content ---`;
    expect(parts[1].text).toBe(expectedContent);

    expect(mockToolRegistry.getTool).toHaveBeenCalledWith(GlobTool.Name);
    expect(mockToolRegistry.getTool).toHaveBeenCalledWith(ReadFileTool.Name);
    expect(mockGlobTool.build).toHaveBeenCalledWith({
      pattern: '**/*',
    });
    expect(mockReadFileTool.build).toHaveBeenCalledWith({
      absolute_path: '/path/to/file1.txt',
    });
    expect(mockReadFileTool.build).toHaveBeenCalledWith({
      absolute_path: '/path/to/file2.txt',
    });
  });

  it('should handle glob returning no content', async () => {
    mockConfig.getFullContext = vi.fn().mockReturnValue(true);
    const mockGlobTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ llmContent: '' }),
      }),
    };
    const mockReadFileTool = {}; // Not used

    mockToolRegistry.getTool.mockImplementation((toolName) => {
      if (toolName === GlobTool.Name) return mockGlobTool;
      if (toolName === ReadFileTool.Name) return mockReadFileTool;
      return null;
    });

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1); // No extra part added
  });

  it('should handle required tools not being found', async () => {
    mockConfig.getFullContext = vi.fn().mockReturnValue(true);
    mockToolRegistry.getTool.mockReturnValue(null);

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1); // No extra part added
    expect(mockToolRegistry.getTool).toHaveBeenCalledWith(GlobTool.Name);
  });

  it('should handle errors when reading full file context (glob error)', async () => {
    mockConfig.getFullContext = vi.fn().mockReturnValue(true);
    const mockGlobTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Glob error')),
      }),
    };
    const mockReadFileTool = {};

    mockToolRegistry.getTool.mockImplementation((toolName) => {
      if (toolName === GlobTool.Name) return mockGlobTool;
      if (toolName === ReadFileTool.Name) return mockReadFileTool;
      return null;
    });

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(2);
    expect(parts[1].text).toBe('\n--- Error reading full file context ---');
  });

  it('should handle errors when reading individual files', async () => {
    mockConfig.getFullContext = vi.fn().mockReturnValue(true);

    const mockGlobTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          llmContent: 'Found 2 files:\n/path/to/file1.txt\n/path/to/file2.txt',
        }),
      }),
    };

    const mockReadFileTool = {
      build: vi.fn().mockImplementation((args) => ({
        execute: vi.fn().mockImplementation(() => {
          if (args.absolute_path === '/path/to/file1.txt') {
            return Promise.resolve({
              llmContent: `Content of ${args.absolute_path}`,
            });
          } else {
            return Promise.reject(new Error('Read error'));
          }
        }),
      })),
    };

    mockToolRegistry.getTool.mockImplementation((toolName) => {
      if (toolName === GlobTool.Name) return mockGlobTool;
      if (toolName === ReadFileTool.Name) return mockReadFileTool;
      return null;
    });

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(2);
    const expectedContent = `
--- Full File Context ---
--- /path/to/file1.txt ---
Content of /path/to/file1.txt

--- /path/to/file2.txt ---
Error reading file.

--- End of content ---`;
    expect(parts[1].text).toBe(expectedContent);
  });
});
