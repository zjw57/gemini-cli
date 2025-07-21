/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { IDEIntegrationManager } from './ideIntegrationManager.js';
export { createMCPIDEIntegration } from './mcpIntegration.js';
export type {
  IDEIntegration,
  IDEIntegrationConfig,
  ActiveFileContext,
} from './types.js';

// Re-export the manager instance for convenience
import { IDEIntegrationManager } from './ideIntegrationManager.js';

/**
 * Global manager instance for IDE integrations
 */
export const ideIntegrationManager = IDEIntegrationManager.getInstance();
