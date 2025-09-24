/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview A tool to apply edits using a custom search and replace format.
 */

/**
 * Custom error class for patch-related failures.
 */
export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

/** Interface representing a single search and replace operation. */
export interface SearchReplaceOp {
  search: string;
  replace: string;
  originalBlock: string; // Keep track of the raw block for reporting
}

/**
 * Parses a search_replace_diff string into an array of SearchReplaceOp objects.
 * @param diffContent The raw search_replace_diff string.
 * @returns An array of SearchReplaceOp.
 */
export function parseSearchReplace(diffContent: string): SearchReplaceOp[] {
  const ops: SearchReplaceOp[] = [];
  const lines = diffContent.split('\n');
  let currentOp: Partial<SearchReplaceOp> = {};
  let currentBlockType: 'SEARCH' | 'REPLACE' | null = null;
  let currentBlockLines: string[] = [];
  let originalBlockLines: string[] = [];

  function commitBlock() {
    if (!currentBlockType) return;
    const content = currentBlockLines.join('\n');
    if (currentBlockType === 'SEARCH') {
      currentOp.search = content;
    } else if (currentBlockType === 'REPLACE') {
      currentOp.replace = content;
      currentOp.originalBlock = originalBlockLines.join('\n');
      ops.push(currentOp as SearchReplaceOp);
      currentOp = {}; // Reset for the next op
    }
    currentBlockLines = [];
  }

  for (const line of lines) {
    if (line.trim() === 'SEARCH') {
      commitBlock();
      currentBlockType = 'SEARCH';
      originalBlockLines = [line];
    } else if (line.trim() === 'REPLACE') {
      commitBlock();
      currentBlockType = 'REPLACE';
      originalBlockLines.push(line);
    } else if (currentBlockType) {
      currentBlockLines.push(line);
      originalBlockLines.push(line);
    }
  }
  commitBlock(); // Commit the last block

  if (ops.length === 0 && diffContent.trim().length > 0) {
    throw new PatchError('Invalid search_replace_diff format. No operations found.');
  }

  return ops;
}

/**
 * Applies a single SearchReplaceOp to the content.
 * @param content The current content.
 * @param op The search and replace operation.
 * @returns The modified content.
 */
function applySingleSearchReplace(content: string, op: SearchReplaceOp): string {
  if (op.search === undefined || op.replace === undefined) {
    throw new PatchError('Invalid operation: search or replace block is missing.');
  }

  if (op.search === '' && op.replace !== '') {
     // Pure insertion at the beginning
     return op.replace + '\n' + content;
  }
  if (op.search === '' && op.replace === '') {
    return content; // No-op
  }

  const parts = content.split(op.search);
  if (parts.length === 1) {
    // Search string not found, check if the replacement is already there
    if (content.includes(op.replace)) {
      console.log('INFO: Search block not found, but replace block seems to be already present. Skipping.');
      return content;
    }
    throw new PatchError(
      `SEARCH block not found in content:\n---\n${op.search}\n---`
    );
  }

  // Replace only the first occurrence to match the typical diff/patch behavior
  return parts[0] + op.replace + parts.slice(1).join(op.search);
}

/**
 * Applies an array of SearchReplaceOp to a string content.
 * @param content The original content of the file.
 * @param ops An array of SearchReplaceOp objects to apply.
 * @returns An object containing the new content and a list of failed operations.
 */
export function applySearchReplaceToContent(
  content: string,
  ops: SearchReplaceOp[],
): {
  newContent: string;
  appliedOps: SearchReplaceOp[];
  failedOps: Array<{ op: SearchReplaceOp; error: PatchError }>;
  noOpOps: SearchReplaceOp[];
} {
  let modifiedContent = content;
  const appliedOps: SearchReplaceOp[] = [];
  const failedOps: Array<{ op: SearchReplaceOp; error: PatchError }> = [];
  const noOpOps: SearchReplaceOp[] = [];

  for (const op of ops) {
    if (op.search === op.replace) {
      noOpOps.push(op);
      continue;
    }
    try {
      const tempContent = applySingleSearchReplace(modifiedContent, op);
      if (tempContent === modifiedContent) {
         // This can happen if the search was not found but replace was, indicating already applied
         noOpOps.push(op);
      } else {
        modifiedContent = tempContent;
        appliedOps.push(op);
      }
    } catch (e: unknown) {
      failedOps.push({ op, error: e as PatchError });
    }
  }

  return { newContent: modifiedContent, appliedOps, failedOps, noOpOps };
}
