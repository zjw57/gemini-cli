/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';

async function search(
  currentDir: string,
  options: {
    fileName: string;
    fileService: FileDiscoveryService;
    debug: boolean;
  },
  foundFiles: Set<string>,
  visited: Set<string>,
) {
  const { fileName, fileService, debug } = options;
  if (visited.has(currentDir)) {
    return;
  }
  visited.add(currentDir);

  if (debug) {
    console.debug(
      `[DEBUG] [MemoryDiscovery][findHierarchicalContext] Processing directory: ${currentDir}`,
    );
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const fileEntry = entries.find(
    (entry) => entry.isFile() && entry.name === fileName,
  );

  if (!fileEntry) {
    // no context file found. terminate traversal here
    return;
  }

  const potentialFilePath = path.join(currentDir, fileName);
  const hasAccess = await fs
    .access(potentialFilePath, fs.constants.R_OK)
    .then(() => true)
    .catch(() => false);

  if (hasAccess) {
    if (debug) {
      console.debug(
        `[DEBUG] [MemoryDiscovery][findHierarchicalContext] Found file with access: ${potentialFilePath}`,
      );
    }
    foundFiles.add(potentialFilePath);

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullSubdirPath = path.join(currentDir, entry.name);
        if (fileService.shouldIgnoreFile(fullSubdirPath)) {
          continue;
        }
        await search(fullSubdirPath, options, foundFiles, visited);
      }
    }
  } else {
    if (debug) {
      console.debug(
        `[DEBUG] [MemoryDiscovery][findHierarchicalContext] File found but no access: ${potentialFilePath}. Stopping search in this branch.`,
      );
    }
  }
}

/**
 * Performs a recursive, depth-first search for a specific file.
 *
 * This function traverses the entire directory structure starting from
 * `startDir`. It searches for `fileName` in every directory and subdirectory,
 * building a list of all found files. This is used to find all hierarchical
 * context files (e.g., GEMINI.md) within a project.
 *
 * @param startDir The absolute path to the directory where the search begins.
 * @param options Configuration options for the search.
 * @param options.fileName The name of the file to search for (e.g., 'GEMINI.md').
 * @param options.fileService An instance of FileDiscoveryService to be used
 *   for all file system operations. This allows for abstraction of the file
 *   system, making the function testable and adaptable.
 * @param options.debug A boolean flag that, when true, enables verbose
 *   logging of the traversal process to the console.
 * @returns A promise that resolves to an array of absolute paths to the
 *   found files.
 */
export async function findHierarchicalContext(
  startDir: string,
  options: {
    fileName: string;
    fileService: FileDiscoveryService;
    debug: boolean;
  },
): Promise<string[]> {
  const { fileName, debug } = options;
  const foundFiles = new Set<string>();
  const visited = new Set<string>();

  if (debug) {
    console.debug(
      `[DEBUG] [MemoryDiscovery][findHierarchicalContext] Starting search for "${fileName}" in "${startDir}"`,
    );
  }

  await search(startDir, options, foundFiles, visited);

  if (debug) {
    console.debug(
      `[DEBUG] [MemoryDiscovery][findHierarchicalContext] Search complete. Found files: ${[
        ...foundFiles,
      ]}`,
    );
  }

  return [...foundFiles];
}
