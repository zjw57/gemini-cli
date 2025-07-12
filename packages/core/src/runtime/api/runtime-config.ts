/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApprovalMode } from '../../config/config.js';
import { AuthType } from './auth-types.js';

export interface IRuntimeConfig {
  auth: {
    type: AuthType;
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