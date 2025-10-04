/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import * as path from 'node:path';
import { globSync } from 'glob';
import type { GlobOptions } from 'glob';

/**
 * Interface for file system operations that may be delegated to different implementations
 */
export interface FileSystemService {
  /**
   * Read text content from a file
   *
   * @param filePath - The path to the file to read
   * @returns The file content as a string
   */
  readTextFile(filePath: string): Promise<string>;

  /**
   * Write text content to a file
   *
   * @param filePath - The path to the file to write
   * @param content - The content to write
   */
  writeTextFile(filePath: string, content: string): Promise<void>;

  /**
   * Finds files with a given name within specified search paths.
   *
   * @param fileName - The name of the file to find.
   * @param searchPaths - An array of directory paths to search within.
   * @param type - The type of entry to find ('file', 'directory', or 'either'). Defaults to 'file'.
   * @returns An array of absolute paths to the found files/directories.
   */
  findFiles(
    fileName: string,
    searchPaths: readonly string[],
    type?: 'file' | 'directory' | 'either',
  ): string[];
}

/**
 * Standard file system implementation
 */
export class StandardFileSystemService implements FileSystemService {
  async readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async writeTextFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
  }

  findFiles(
    fileName: string,
    searchPaths: readonly string[],
    type: 'file' | 'directory' | 'either' = 'file',
  ): string[] {
    return searchPaths.flatMap((searchPath) => {
      // Use 'wp' (wildcard path) to match files or directories
      let pattern = path.posix.join(searchPath, '**', fileName);

      const globOptions: GlobOptions = {
        absolute: true,
        // 'stat: true' might be needed depending on glob version/platform for accurate type checks
        // but let's try without first as it's faster.
      };

      if (type === 'file') {
        globOptions.nodir = true;
      } else if (type === 'directory') {
        // Append '/' to force directory match
        pattern += '/';
      }
      // For 'either', we don't set nodir or append '/'.

      const matches = globSync(pattern, globOptions) as string[];

      if (type === 'file') {
        return matches; // nodir: true handles it
      } else if (type === 'directory') {
        // glob with '/' might return paths with trailing '/', remove them for consistency
        return matches.map((m) => (m.endsWith('/') ? m.slice(0, -1) : m));
      }

      // For 'either', filter manually to ensure existence (glob might return broken symlinks)
      return matches.filter((matchPath) => {
        try {
          fsSync.statSync(matchPath);
          return true;
        } catch (_) {
          return false;
        }
      });
    });
  }
}
