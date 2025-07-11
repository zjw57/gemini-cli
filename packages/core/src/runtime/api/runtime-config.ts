/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApprovalMode } from '../../config/config.js';

export interface IRuntimeConfig {
  auth: {
    // We'll flesh this out in Phase 1
    type: string;
    credentials?: unknown;
  };
  model: {
    name: string;
  };
  tools: {
    exclude?: string[];
    approvalMode: ApprovalMode;
  };
  system?: {
    proxy?: string;
  };
  debug?: {
    enabled: boolean;
  };
}