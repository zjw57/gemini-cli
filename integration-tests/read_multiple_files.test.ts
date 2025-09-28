/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';

describe('read_multiple_files', () => {
  it('should be able to read multiple files using read_file', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to read multiple files');
    rig.createFile('file1.txt', 'file 1 content');
    rig.createFile('file2.txt', 'file 2 content');

    const prompt = `Read the contents of file1.txt and file2.txt and then print the contents of each file.`;

    const result = await rig.run(prompt);

    // Check for multiple read_file calls
    const allTools = rig.readToolLogs();
    const readFileCalls = allTools.filter(
      (t) => t.toolRequest.name === 'read_file',
    );

    // Expect at least 2 read_file calls
    const foundValidPattern = readFileCalls.length >= 2;

    // Add debugging information
    if (!foundValidPattern) {
      printDebugInfo(rig, result, {
        'read_file calls': readFileCalls.length,
        'all tools': allTools.map((t) => t.toolRequest.name),
      });
    }

    expect(
      foundValidPattern,
      'Expected to find multiple read_file tool calls',
    ).toBeTruthy();

    // Validate model output - will throw if no output
    validateModelOutput(result, null, 'Read multiple files test');
  });
});
