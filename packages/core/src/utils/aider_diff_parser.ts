/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AiderDiff {
  filePath: string;
  search: string;
  replace: string;
}

/**
 * Parses an Aider-formatted diff string into a structured array of changes.
 * This parser is designed to be flexible and robust against common variations
 * in LLM output, such as inconsistent whitespace or number of markers.
 *
 * @param diff The raw diff string from an LLM.
 * @returns An array of AiderDiff objects.
 */
export function parseAiderDiff(diff: string): AiderDiff[] {
  const diffs: AiderDiff[] = [];

  // Regex to identify the start/middle/end markers of a diff block.
  // - `\s*`: Matches any leading whitespace.
  // - `<{4,}`: Matches four or more '<' characters.
  // - `\s+`: Matches one or more whitespace characters between marker and text.
  const searchRegex = /^\s*<{4,}\s+SEARCH\s*$/;
  const equalsRegex = /^\s*={4,}\s*$/;
  const replaceRegex = /^\s*>{4,}\s+REPLACE\s*$/;

  let currentDiff: Partial<AiderDiff> = {};
  let state: 'FILE' | 'SEARCH' | 'REPLACE' = 'FILE';
  let searchBlock: string[] = [];
  let replaceBlock: string[] = [];

  const contentLines = diff.replace(/\r\n/g, '\n').split('\n');

  for (const line of contentLines) {
    if (line.trim().startsWith('```')) {
      continue;
    }

    if (searchRegex.test(line)) {
      state = 'SEARCH';
      searchBlock = [];
    } else if (equalsRegex.test(line)) {
      state = 'REPLACE';
      replaceBlock = [];
    } else if (replaceRegex.test(line)) {
      if (currentDiff.filePath) {
        currentDiff.search = searchBlock.join('\n');
        currentDiff.replace = replaceBlock.join('\n');
        diffs.push(currentDiff as AiderDiff);
      }
      currentDiff = {};
      state = 'FILE';
    } else {
      switch (state) {
        case 'FILE':
          if (line.trim()) {
            currentDiff.filePath = line.trim();
            state = 'SEARCH';
          }
          break;
        case 'SEARCH':
          searchBlock.push(line);
          break;
        case 'REPLACE':
          replaceBlock.push(line);
          break;
        default:
          break;
      }
    }
  }

  return diffs;
}
