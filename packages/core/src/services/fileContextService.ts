/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import path from 'node:path';

export class FileContextService extends EventEmitter {
  private readonly trackedFiles = new Set<string>();
  private cache: Map<string, { hash: string; tokenCount: number }> = new Map();

  constructor(
    private countTokens: (text: string) => Promise<{ totalTokens: number }>,
  ) {
    super();
  }

  async add(filePath: string): Promise<string> {
    const resolvedPath = path.resolve(filePath);
    try {
      await fs.stat(resolvedPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw e;
    }
    this.trackedFiles.add(resolvedPath);
    this.emit('change');
    return resolvedPath;
  }

  remove(filePath: string): boolean {
    const resolvedPath = path.resolve(filePath);
    const deleted = this.trackedFiles.delete(resolvedPath);
    if (deleted) {
      this.emit('change');
    }
    return deleted;
  }

  async getTrackedFiles(): Promise<string[]> {
    const stillTracked: string[] = [];
    let changed = false;
    for (const file of this.trackedFiles) {
      try {
        await fs.stat(file);
        stillTracked.push(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          // The file was deleted, so we untrack it.
          this.trackedFiles.delete(file);
          changed = true;
          continue;
        }
        // For other errors, we'll just not include it for now
        // but keep it tracked.
      }
    }

    if (changed) {
      this.emit('change');
    }
    return stillTracked;
  }

  async getTrackedFilesWithTokenCounts(): Promise<
    Array<{ path: string; tokenCount: number }>
  > {
    const filesWithTokens = [];
    for (const filePath of this.trackedFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        const cached = this.cache.get(filePath);
        if (cached && cached.hash === hash) {
          filesWithTokens.push({
            path: filePath,
            tokenCount: cached.tokenCount,
          });
          continue;
        }

        const { totalTokens } = await this.countTokens(content);
        this.cache.set(filePath, { hash, tokenCount: totalTokens });
        filesWithTokens.push({ path: filePath, tokenCount: totalTokens });
      } catch (e) {
        // TODO: Surface this error to the user.
        filesWithTokens.push({ path: filePath, tokenCount: 0 });
      }
    }
    return filesWithTokens;
  }

  has(filePath: string): boolean {
    return this.trackedFiles.has(path.resolve(filePath));
  }
}
