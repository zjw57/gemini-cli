/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A more robust check to determine if a Buffer contains binary data.
 *
 * This function uses several heuristics:
 * 1.  It checks for the presence of a NULL byte, which is a very strong
 *     indicator of binary data.
 * 2.  It allows for common text control characters like tabs, newlines, and
 *     carriage returns, as well as the ANSI escape character (0x1B).
 * 3.  It calculates the percentage of other "suspicious" bytes (i.e., other
 *     control characters or bytes outside the standard printable ASCII range).
 * 4.  If this percentage exceeds a certain threshold, the buffer is considered binary.
 *
 * This approach is designed to correctly classify interactive TTY output, which
 * is rich in ANSI codes, as text, while still identifying actual binary files.
 *
 * @param data The Buffer to check.
 * @param sampleSize The number of bytes from the start of the buffer to test.
 * @returns True if the buffer is deemed likely to be binary, false otherwise.
 */
export function isBinary(
  data: Buffer | null | undefined,
  sampleSize = 1024,
): boolean {
  if (!data) {
    return false;
  }

  const sample = data.length > sampleSize ? data.subarray(0, sampleSize) : data;
  if (sample.length === 0) {
    return false;
  }

  // Check for a Byte Order Mark (BOM), which indicates text.
  if (
    (sample.length >= 2 &&
      ((sample[0] === 0xfe && sample[1] === 0xff) || // UTF-16BE
        (sample[0] === 0xff && sample[1] === 0xfe))) || // UTF-16LE
    (sample.length >= 3 &&
      sample[0] === 0xef &&
      sample[1] === 0xbb &&
      sample[2] === 0xbf) // UTF-8
  ) {
    return false;
  }

  let suspiciousBytes = 0;
  for (const byte of sample) {
    if (byte === 0) {
      // NULL byte is a very strong indicator of a binary file.
      return true;
    }

    // Check for non-printable characters, but be lenient for TTY control codes.
    // Allow:
    // - 9 (tab)
    // - 10 (newline)
    // - 13 (carriage return)
    // - 27 (ESC, for ANSI codes)
    // - 32-126 (printable ASCII)
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isCommonControlChar = byte === 9 || byte === 10 || byte === 13;
    const isAnsiEscape = byte === 27;

    if (!isPrintableAscii && !isCommonControlChar && !isAnsiEscape) {
      suspiciousBytes++;
    }
  }

  // If more than 30% of the sample consists of suspicious characters,
  // it's likely binary. This threshold is a heuristic.
  if (suspiciousBytes / sample.length > 0.3) {
    return true;
  }

  return false;
}
