/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';

describe('Context Compression', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => {
    await rig.cleanup();
  });

  it('should automatically compress on long conversation', async () => {
    await rig.setup('automatic compression with low threshold', {
      settings: {
        model: {
          chatCompression: {
            contextPercentageThreshold: 0.0001,
          },
        },
      },
    });

    // This prompt should be enough to exceed the 0.01%(~105 token) threshold.
    await rig.run(
      'Dont do anything except returning a long paragragh. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case. This is a moderately long sentence designed to exceed the very low compression threshold we have set for this specific test case.',
    );

    // This second prompt will trigger the compression check.
    await rig.run('Return another long paragragh.');

    const foundEvent = await rig.waitForTelemetryEvent('chat_compression');
    expect(foundEvent).toBe(true);
  });

  it('should not automatically compress on short conversation', async () => {
    await rig.setup('no automatic compression on short conversation', {
      settings: {
        model: {
          chatCompression: {
            contextPercentageThreshold: 0.5, // 50% threshold
          },
        },
      },
    });

    await rig.run('this is a short prompt');
    await rig.run('this is another short prompt');

    const foundEvent = await rig.waitForTelemetryEvent(
      'chat_compression',
      2000,
    ); // Wait for a short time
    expect(foundEvent).toBe(false);
  });

  // it('should handle compression failure on token inflation', async () => {
  //   // This test is tricky as it relies on model behavior.
  //   // We use a very short prompt hoping the XML overhead causes inflation.
  //   vi.setTimeout(30000); // Increase timeout for this test
  //   await rig.setup('compression failure on token inflation', {
  //     settings: {
  //       model: {
  //         // High threshold to prevent automatic compression
  //         chatCompression: {
  //           contextPercentageThreshold: 0.99,
  //         },
  //       },
  //     },
  //   });

  //   await rig.run('hi');
  //   const result = await rig.run('/compress');

  //   const foundEvent = await rig.waitForTelemetryEvent('chat_compression');
  //   expect(foundEvent).toBe(true);

  //   // Check the telemetry log for the specific failure status
  //   const logFilePath = join(rig.testDir!, 'telemetry.log');
  //   const logContent = readFileSync(logFilePath, 'utf-8');

  //   // A simple check for the failure message in the output
  //   expect(result).toContain('Compression was not beneficial');
  // });
});
