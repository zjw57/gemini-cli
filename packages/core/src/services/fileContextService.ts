/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

export class FileContextService {
  private readonly trackedFiles = new Set<string>();

  add(filePath: string): void {
    // TODO: Path resolution should be robust. `path.resolve` is a good
    // start, but consider edge cases like symlinks or network drives if
    // they are relevant to the execution environment.
    this.trackedFiles.add(path.resolve(filePath));
  }

  remove(filePath: string): string | undefined {
    const resolvedPath = path.resolve(filePath);
    if (this.trackedFiles.has(resolvedPath)) {
      this.trackedFiles.delete(resolvedPath);
      return resolvedPath;
    }
    return undefined;
  }

  getTrackedFiles(): string[] {
    // TODO: Error handling for when files are not found or unreadable.
    // This method currently assumes all paths in `trackedFiles` are valid and
    // readable. We should add a mechanism to handle cases where a file is
    // deleted or permissions change during a session. This could involve
    // returning a status for each file or filtering out invalid files.

    // TODO: Handle large files. Reading entire large files into memory on
    // every turn can be inefficient and hit token limits. Implement a
    // strategy for large files, such as truncation with a clear indicator,
    // or summarizing the content.
    return Array.from(this.trackedFiles);
  }

  has(filePath: string): boolean {
    return this.trackedFiles.has(path.resolve(filePath));
  }
}