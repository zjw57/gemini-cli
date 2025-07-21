/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
  getProjectTempDir,
  sessionId,
  uiTelemetryService,
  SessionMetrics,
} from '@google/gemini-cli-core';

const cleanupFunctions: Array<() => void> = [];

export function registerCleanup(fn: () => void) {
  cleanupFunctions.push(fn);
}

export function runExitCleanup() {
  for (const fn of cleanupFunctions) {
    try {
      fn();
    } catch (_) {
      // Ignore errors during cleanup.
    }
  }
  cleanupFunctions.length = 0; // Clear the array
}

export function initializeExitHooks() {
  process.on('exit', runExitCleanup);
  registerCleanup(saveSessionStats);
}

export type SessionStats = SessionMetrics & {
  sessionId: string;
  timestamp: string;
};

export function saveSessionStats() {
  try {
    const tempDir = getProjectTempDir(process.cwd());
    mkdirSync(tempDir, { recursive: true });
    const statsFile = join(tempDir, 'stats.jsonl');

    const currentMetrics = uiTelemetryService.getMetrics();
    const sessionStats: SessionStats = {
      ...currentMetrics,
      sessionId,
      timestamp: new Date().toISOString(),
    };

    appendFileSync(statsFile, JSON.stringify(sessionStats) + '\n');
  } catch {
    // Ignore errors.
  }
}

export async function cleanupCheckpoints() {
  try {
    const tempDir = getProjectTempDir(process.cwd());
    mkdirSync(tempDir, { recursive: true });
    const checkpointsDir = join(tempDir, 'checkpoints');
    await fs.rm(checkpointsDir, { recursive: true, force: true });
  } catch {
    // Ignore errors if the directory doesn't exist or fails to delete.
  }
}
