/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeTelemetry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
} from './sdk.js';
import { Config } from '../config/config.js';
import { NodeSDK } from '@opentelemetry/sdk-node';

vi.mock('@opentelemetry/sdk-node');
vi.mock('../config/config.js');
vi.mock('./sdk.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sdk.js')>();
  return {
    ...original,
    isTelemetrySdkInitialized: vi.fn(),
    shutdownTelemetry: vi.fn(),
  };
});

describe('telemetry', () => {
  let mockConfig: Config;
  let mockNodeSdk: NodeSDK;

  beforeEach(() => {
    vi.resetAllMocks();

    mockConfig = {
      getTelemetryEnabled: vi.fn().mockReturnValue(true),
      getTelemetryOtlpEndpoint: vi
        .fn()
        .mockReturnValue('http://localhost:4317'),
      getTelemetryOtlpProtocol: vi.fn().mockReturnValue('grpc'),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getTelemetryOutfile: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    mockNodeSdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as NodeSDK;
    vi.mocked(NodeSDK).mockImplementation(() => mockNodeSdk);
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it('should initialize the telemetry service', () => {
    vi.mocked(isTelemetrySdkInitialized).mockReturnValue(false);
    initializeTelemetry(mockConfig);
    expect(NodeSDK).toHaveBeenCalled();
    expect(mockNodeSdk.start).toHaveBeenCalled();
  });

  it('should shutdown the telemetry service', async () => {
    vi.mocked(isTelemetrySdkInitialized).mockReturnValue(true);
    await shutdownTelemetry(mockConfig);

    expect(vi.mocked(shutdownTelemetry)).toHaveBeenCalled();
  });
});
