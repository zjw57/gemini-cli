/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TDDState } from './reminder-types.js';

export const cimConfig = {
  // How often (in turns) the CIM should request a conversation summary.
  summarizationTurnCount: 5,

  // Stagnation Detector Tuning
  stagnation: {
    // Size of the buffer for analyzing recent actions.
    historyBufferSize: 10,
    // Max times the same action can occur consecutively before warning.
    immediateRepetitionLimit: 3,
    // Max times the same file can be read within the buffer window.
    repetitiveReadLimit: 4,

    // Max turns allowed in specific states before warning.
    stateTimeouts: {
      [TDDState.EXPLORING]: 15,
      [TDDState.WRITING_TEST]: 8,
      [TDDState.WRITING_FIX]: 12,
    },
  },
};
