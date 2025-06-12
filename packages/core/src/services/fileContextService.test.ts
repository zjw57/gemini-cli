/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileContextService } from './fileContextService.js';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

const mockCountTokens = vi.fn().mockResolvedValue({ totalTokens: 100 });

describe('FileContextService', () => {
  it('should add and retrieve a file path', async () => {
    const service = new FileContextService(mockCountTokens);
    const filePath = 'test.txt';
    await service.add(filePath);
    expect(await service.getTrackedFiles()).toEqual([path.resolve(filePath)]);
  });

  it('should add and retrieve an absolute file path', async () => {
    const service = new FileContextService(mockCountTokens);
    const filePath = path.resolve('test.txt');
    await service.add(filePath);
    expect(await service.getTrackedFiles()).toEqual([filePath]);
  });

  it('should remove a file path', async () => {
    const service = new FileContextService(mockCountTokens);
    const filePath = 'test.txt';
    await service.add(filePath);
    service.remove(filePath);
    expect(await service.getTrackedFiles()).toEqual([]);
  });

  it('should return true from has() for a tracked file', async () => {
    const service = new FileContextService(mockCountTokens);
    const filePath = 'test.txt';
    await service.add(filePath);
    expect(service.has(filePath)).toBe(true);
  });

  it('should return false from has() for an untracked file', () => {
    const service = new FileContextService(mockCountTokens);
    const filePath = 'test.txt';
    expect(service.has(filePath)).toBe(false);
  });

  it('should handle multiple files', async () => {
    const service = new FileContextService(mockCountTokens);
    const filePaths = ['test1.txt', 'test2.txt'];
    for (const filePath of filePaths) {
      await service.add(filePath);
    }
    expect((await service.getTrackedFiles()).sort()).toEqual(
      filePaths.map((p) => path.resolve(p)).sort()
    );
  });
});
