/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves a prompt. If the input string is a valid path to an existing
 * file, its content is read and returned. Otherwise, the original string
 * is returned.
 *
 * @param promptOrPath The user-provided string from the --prompt argument.
 * @param workingDir The current working directory to resolve relative paths from.
 * @returns The file content if it's a valid path, otherwise the original string.
 */
export function resolvePromptFromFile(
  promptOrPath: string,
  workingDir: string,
): string {
  // An empty string can never be a file, so return early.
  if (!promptOrPath) {
    return promptOrPath;
  }

  try {
    const potentialPath = path.resolve(workingDir, promptOrPath);
    // Check if the path exists and is a file.
    if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return fs.readFileSync(potentialPath, 'utf-8');
    }
  } catch (_e) {
    // If any fs operation fails (e.g., permission errors),
    // assume it's not a file path and return the original string.
    // We can add logging here in the future if needed.
    return promptOrPath;
  }

  // If the path doesn't exist or isn't a file, return the original string.
  return promptOrPath;
}
