/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { IDEIntegrationRegistry } from './registry.js';
export { IDEIntegrationManager } from './ideIntegrationManager.js';
export type {
  IDEIntegration,
  IDEIntegrationFactory,
  IDEIntegrationConfig,
  ActiveFileContext,
} from './types.js';

// Re-export the registry instance for convenience
import { IDEIntegrationRegistry } from './registry.js';
import { IDEIntegrationManager } from './ideIntegrationManager.js';

/**
 * Global registry instance for IDE integrations
 */
export const ideIntegrationRegistry = IDEIntegrationRegistry.getInstance();

/**
 * Global manager instance for IDE integrations
 */
export const ideIntegrationManager = IDEIntegrationManager.getInstance();
