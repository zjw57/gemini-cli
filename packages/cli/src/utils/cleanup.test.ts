/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import * as fs from 'fs';
import { saveSessionStats } from './cleanup.js';
import { getProjectTempDir, uiTelemetryService, sessionId } from '@google/gemini-cli-core';

// Mock modules
vi.mock('fs');
vi.mock('@google/gemini-cli-core', () => ({
  getProjectTempDir: vi.fn(),
  sessionId: 'test-session-id',
  uiTelemetryService: {
    getMetrics: vi.fn(),
  },
}));

describe('saveSessionStats', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Set up mock implementations
    vi.mocked(getProjectTempDir).mockReturnValue('/fake/home/.gemini/tmp/project-hash');
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue({
      models: { 'gemini-pro': { api: { totalRequests: 1 } } },
      tools: { totalCalls: 2 },
    });
  });

  afterEach(() => {
    // Clear all mocks to ensure test isolation
    vi.clearAllMocks();
  });

  it('should write the correct data to the stats file', () => {
    // Call the function directly
    saveSessionStats();

    // Verify that the directory is created and the stats file is appended
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledOnce();
    expect(vi.mocked(fs.appendFileSync)).toHaveBeenCalledOnce();

    // Check the mkdirSync call
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(
      '/fake/home/.gemini/tmp/project-hash',
      { recursive: true }
    );

    // Check the path of the file that was written to
    const statsFilePath = join(
      '/fake/home/.gemini/tmp/project-hash',
      'stats.jsonl',
    );
    const [filePath, fileContent] = vi.mocked(fs.appendFileSync).mock.calls[0];
    expect(filePath).toBe(statsFilePath);

    // Check the content that was written
    const writtenData = JSON.parse(fileContent.replace('\n', ''));
    expect(writtenData).toEqual({
      models: { 'gemini-pro': { api: { totalRequests: 1 } } },
      tools: { totalCalls: 2 },
      sessionId: 'test-session-id',
      timestamp: expect.any(String),
    });
  });
});