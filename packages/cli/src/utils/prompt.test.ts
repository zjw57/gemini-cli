/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { resolvePromptFromFile } from './prompt';
import fs from 'node:fs';
import path from 'node:path';

// Mock the 'fs' module
vi.mock('node:fs');

describe('resolvePromptFromFile', () => {
  const workingDir = '/test/dir';

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
  });

  it('should return the original string if it is not a file path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const prompt = 'This is a normal prompt.';
    const result = resolvePromptFromFile(prompt, workingDir);
    expect(result).toBe(prompt);
    expect(fs.existsSync).toHaveBeenCalledWith(
      path.resolve(workingDir, prompt),
    );
  });

  it('should return the file content if the string is a valid file path', () => {
    const filePath = 'prompt.txt';
    const absolutePath = path.resolve(workingDir, filePath);
    const fileContent = 'This is the content of the file.';

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue(fileContent);

    const result = resolvePromptFromFile(filePath, workingDir);

    expect(result).toBe(fileContent);
    expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
    expect(fs.statSync).toHaveBeenCalledWith(absolutePath);
    expect(fs.readFileSync).toHaveBeenCalledWith(absolutePath, 'utf-8');
  });

  it('should return the original string if the path exists but is a directory', () => {
    const dirPath = 'a-directory';
    const absolutePath = path.resolve(workingDir, dirPath);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as fs.Stats);

    const result = resolvePromptFromFile(dirPath, workingDir);

    expect(result).toBe(dirPath);
    expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
    expect(fs.statSync).toHaveBeenCalledWith(absolutePath);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('should return the original string if fs.existsSync throws an error', () => {
    const prompt = 'some/path';
    vi.mocked(fs.existsSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = resolvePromptFromFile(prompt, workingDir);
    expect(result).toBe(prompt);
  });

  it('should return an empty string if the input is empty', () => {
    const result = resolvePromptFromFile('', workingDir);
    expect(result).toBe('');
    expect(fs.existsSync).not.toHaveBeenCalled();
  });
});
