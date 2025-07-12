/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IPlatform } from './IPlatform.js';

/**
 * A concrete implementation of the IPlatform interface for the Node.js environment.
 */
export class NodePlatform implements IPlatform {
  public async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  public async rm(filePath: string): Promise<void> {
    try {
      await fs.rm(filePath, { force: true, recursive: true });
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code !== 'ENOENT') {
        throw e;
      }
    }
  }

  public getHomeDir(): string {
    return os.homedir();
  }

  public joinPath(...paths: string[]): string {
    return path.join(...paths);
  }
}