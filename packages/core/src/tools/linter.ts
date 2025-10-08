/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';

// ------------------- Ruff Utilities -------------------

/**
 * A helper function to run Ruff on a string of code and return a set of error lines.
 * It uses stdin to pass the code, avoiding the need for temporary files.
 *
 * @param codeString The Python code to lint.
 * @returns A promise that resolves to a Set of unique error strings from Ruff.
 */
function runRuffAndGetErrors(codeString: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    const command = 'ruff';
    const args = [
      'check',
      '--select',
      'F', // Focus on Pyflakes (logical errors)
      '--ignore',
      'F401,F841',
      '--no-fix', // CRITICAL: Do not fix, just report
      '--output-format',
      'concise',
      '--stdin-filename',
      'temp_file.py', // A dummy filename for Ruff to use in reports
      '-', // Signifies reading from stdin
    ];

    const ruffProcess = spawn(command, args);

    let stdout = '';

    ruffProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // We resolve on 'close', as Ruff will exit with a non-zero code if it finds
    // linting errors, which is expected behavior.
    ruffProcess.on('close', () => {
      const errorLines = stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0); // Filter out empty lines
      resolve(new Set(errorLines));
    });

    // Handle execution errors, such as 'ruff' not being installed.
    ruffProcess.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        console.warn('Warning: Ruff command not found. Skipping lint check.');
      } else {
        console.error(
          'An error occurred while trying to run Ruff:',
          err.message,
        );
      }
      resolve(new Set()); // Return an empty set on error, like the Python version
    });

    // Write the code to the process's standard input and then close the stream.
    ruffProcess.stdin.write(codeString);
    ruffProcess.stdin.end();
  });
}

/**
 * Validates a patch by checking only for *new* Ruff errors it introduces.
 *
 * @param originalCode The string content of the file before the patch.
 * @param patchedCode The string content of the file after the patch.
 * @param ignoreCodes An optional array of error codes (e.g., ["F841"]) to ignore.
 * @returns A promise resolving to a tuple: [is_clean: boolean, new_errors: string[]].
 */
export async function validatePatchQuality(
  originalCode: string,
  patchedCode: string,
  ignoreCodes: string[] = [],
): Promise<[boolean, string[]]> {
  console.log(`Validating patch quality...`);
  try {
    // Run Ruff on both versions of the code concurrently for efficiency.
    const [originalErrors, patchedErrors] = await Promise.all([
      runRuffAndGetErrors(originalCode),
      runRuffAndGetErrors(patchedCode),
    ]);

    // Determine which errors are newly introduced by the patch.
    const newlyIntroducedErrors: string[] = [];
    for (const err of patchedErrors) {
      if (!originalErrors.has(err)) {
        newlyIntroducedErrors.push(err);
      }
    }

    if (newlyIntroducedErrors.length === 0) {
      return [true, []];
    }

    // Filter out any new errors that are on the ignore list.
    // NOTE: The original Python code had a bug here that incorrectly checked the
    // column number instead of the error code. This implementation is corrected
    // to match the clear intent of ignoring specific error codes.
    const criticalNewErrors = newlyIntroducedErrors.filter((err) => {
      const parts = err.trim().split(':');
      // A valid line must have at least 4 parts: file:line:col:message
      if (parts.length < 4) return true;

      // The message part contains the error code (e.g., "F841 Unused variable 'x'")
      const messagePart = parts.slice(3).join(':').trim();
      const errorCodeMatch = messagePart.match(/^[A-Z]+\d+/);

      if (!errorCodeMatch) return true; // Keep if no valid error code is found

      const errorCode = errorCodeMatch[0];
      console.log(errorCode);
      const shouldIgnore = ignoreCodes.some((codeToIgnore) =>
        errorCode.startsWith(codeToIgnore),
      );

      return !shouldIgnore; // Keep the error if it's NOT on the ignore list
    });

    if (criticalNewErrors.length === 0) {
      return [true, []];
    }

    // Replicate the special case from the Python code.
    if (
      criticalNewErrors.length === 1 &&
      criticalNewErrors[0].trim() === 'All checks passed!'
    ) {
      return [true, []];
    }

    return [false, criticalNewErrors];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return [
      false,
      [`An unexpected error occurred during linting: ${e.message}`],
    ];
  }
}
