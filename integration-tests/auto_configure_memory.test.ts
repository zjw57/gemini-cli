/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig } from './test-helper.js';

describe('auto_configure_memory', () => {
  it('should set the --max-old-space-size flag', async () => {
    const rig = new TestRig();
    await rig.setup('should set the --max-old-space-size flag');

    const prompt = `What is the capital of France?`;

    await rig.run(prompt);

    const debugOutput = rig.getDebugOutput();

    expect(debugOutput).toContain('--max-old-space-size');
  });
});
