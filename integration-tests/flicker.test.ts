/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig } from './test-helper.js';

describe('Flicker Detector', () => {
  // TODO: https://github.com/google-gemini/gemini-cli/issues/11170
  it.skip('should not detect a flicker under the max height budget', async () => {
    const rig = new TestRig();
    await rig.setup('flicker-detector-test');

    const run = await rig.runInteractive();
    const prompt = 'Tell me a fun fact.';
    await run.type(prompt);
    await run.type('\r');

    const hasUserPromptEvent = await rig.waitForTelemetryEvent('user_prompt');
    expect(hasUserPromptEvent).toBe(true);

    const hasSessionCountMetric = await rig.waitForMetric('session.count');
    expect(hasSessionCountMetric).toBe(true);

    // We expect NO flicker event to be found.
    const flickerMetric = rig.readMetric('ui.flicker.count');
    expect(flickerMetric).toBeNull();
  });
});
