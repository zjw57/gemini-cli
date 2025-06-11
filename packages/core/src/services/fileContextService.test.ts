/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileContextService } from './fileContextService.js';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('FileContextService', () => {
  it('should add and retrieve a file path', () => {
    const service = new FileContextService();
    const filePath = 'test.txt';
    service.add(filePath);
    expect(service.getTrackedFiles()).toEqual([path.resolve(filePath)]);
  });

  it('should add and retrieve an absolute file path', () => {
    const service = new FileContextService();
    const filePath = path.resolve('test.txt');
    service.add(filePath);
    expect(service.getTrackedFiles()).toEqual([filePath]);
  });

  it('should remove a file path', () => {
    const service = new FileContextService();
    const filePath = 'test.txt';
    service.add(filePath);
    service.remove(filePath);
    expect(service.getTrackedFiles()).toEqual([]);
  });

  it('should return true from has() for a tracked file', () => {
    const service = new FileContextService();
    const filePath = 'test.txt';
    service.add(filePath);
    expect(service.has(filePath)).toBe(true);
  });

  it('should return false from has() for an untracked file', () => {
    const service = new FileContextService();
    const filePath = 'test.txt';
    expect(service.has(filePath)).toBe(false);
  });

  it('should handle multiple files', () => {
    const service = new FileContextService();
    const filePaths = ['test1.txt', 'test2.txt'];
    for (const filePath of filePaths) {
      service.add(filePath);
    }
    expect(service.getTrackedFiles().sort()).toEqual(
      filePaths.map((p) => path.resolve(p)).sort()
    );
  });
});