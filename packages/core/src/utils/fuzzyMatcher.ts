/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Fuse from 'fuse.js';

/**
 * Configuration for the fuzzy matching algorithm.
 * These values are centralized to allow for easy tuning and to provide a clear
 * explanation of the heuristics used.
 */
const FuzzyMatcherConfig = {
  /**
   * The minimum number of lines a search chunk should have. This provides a baseline
   * level of context for small snippets, improving search stability and reducing
   * false positives for common, short lines of code.
   */
  MINIMUM_CHUNK_SIZE: 5,

  /**
   * The number of extra lines to add to the chunk size beyond the snippet's own
   * line count. Half of this value is added as context before and after the
   * snippet's expected location within the chunk, improving disambiguation.
   * This value should be an even number.
   */
  CONTEXT_LINES: 2,

  /**
   * The Fuse.js threshold for matching. A value of 0.0 requires a perfect match,
   * while 1.0 would match anything. 0.4 provides a good balance for source code,
   * tolerating minor typos and whitespace differences without being overly loose.
   */
  FUSE_THRESHOLD: 0.4,
};

/**
 * Represents a chunk of text used for searching. Includes the content
 * and its original starting line number for later reconstruction.
 */
interface SearchChunk {
  content: string;
  startLine: number;
}

/**
 * The structured result of a fuzzy match operation.
 */
export interface FuzzyMatchResult {
  /** The best-matching text block found in the source content. */
  bestMatch: string;
  /** The starting line number (0-indexed) of the best match in the source. */
  startLine: number;
  /** A confidence score from 0 (perfect match) to 1 (complete mismatch). */
  confidenceScore: number;
}

/**
 * Creates an array of overlapping text chunks from a source string.
 *
 * Overlapping text chunks are superior for multi-line code blocks as opposed to line-based
 * searching.
 *
 * @param text The full source text content.
 * @param chunkSize The number of lines in each chunk.
 * @param stepSize The number of lines to slide the window forward for each new chunk.
 * @returns An array of SearchChunk objects.
 */
function createOverlappingChunks(
  text: string,
  chunkSize: number,
  stepSize: number = 1,
): SearchChunk[] {
  const lines = text.split('\n');
  const chunks: SearchChunk[] = [];

  // If the text is smaller than the chunk size, treat the whole text as a single chunk.
  if (lines.length <= chunkSize) {
    if (text.trim() !== '') {
      chunks.push({ content: text, startLine: 0 });
    }
    return chunks;
  }

  for (let i = 0; i <= lines.length - chunkSize; i += stepSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    chunks.push({
      content: chunkLines.join('\n'),
      startLine: i,
    });
  }

  return chunks;
}

/**
 * Performs a fuzzy search to find the best match for a given snippet within a
 * larger body of source text.
 *
 * @param sourceText The complete content of the file to search within.
 * @param snippetToFind The text snippet that needs to be found.
 * @returns A FuzzyMatchResult object if a reasonable match is found, otherwise null.
 */
export function findBestFuzzyMatch(
  sourceText: string,
  snippetToFind: string,
): FuzzyMatchResult | null {
  // Cannot search for or within an empty or whitespace-only string.
  if (
    !snippetToFind ||
    snippetToFind.trim() === '' ||
    !sourceText ||
    sourceText.trim() === ''
  ) {
    return null;
  }

  // Determine Optimal Chunk Size
  // The chunk size should be at least as large as the snippet we're looking for.
  const snippetLineCount = snippetToFind.split('\n').length;

  // Calculate the chunk size needed to contain the snippet plus surrounding context.
  const requiredChunkSize = snippetLineCount + FuzzyMatcherConfig.CONTEXT_LINES;

  // The final chunk size is the greater of the required size and the configured minimum.
  // This ensures stability even for very small snippets.
  const chunkSize = Math.max(
    requiredChunkSize,
    FuzzyMatcherConfig.MINIMUM_CHUNK_SIZE,
  );

  // Generate Searchable Chunks using a sliding window.
  const searchChunks = createOverlappingChunks(sourceText, chunkSize);
  if (searchChunks.length === 0) {
    return null;
  }

  // Configure and Execute Fuse.js Search
  const fuse = new Fuse(searchChunks, {
    includeScore: true,
    threshold: FuzzyMatcherConfig.FUSE_THRESHOLD,
    keys: ['content'],
    ignoreLocation: true,
  });

  const searchResults = fuse.search(snippetToFind);

  if (searchResults.length === 0) {
    return null;
  }

  // Process and Return the Best Result
  const bestResult = searchResults[0];
  const confidenceScore = bestResult.score!; // Fuse.js guarantees a score when includeScore is true.

  // Reconstruct the actual block from the original file content using the
  // matched chunk's start line and the snippet's line count. This ensures we
  // return the correctly-sized block, not the entire search chunk.
  const lines = sourceText.split('\n');
  const actualBlock = lines
    .slice(
      bestResult.item.startLine,
      bestResult.item.startLine + snippetLineCount,
    )
    .join('\n');

  return {
    bestMatch: actualBlock,
    startLine: bestResult.item.startLine,
    confidenceScore,
  };
}
