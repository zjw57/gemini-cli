/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IDEIntegrationFactory } from '../types.js';
import { VSCodeIntegration } from './vscodeIntegration.js';

/**
 * Factory function to create VS Code IDE integration instances
 */
export const vscodeIntegrationFactory: IDEIntegrationFactory = async (config) =>
  new VSCodeIntegration(config);

export { VSCodeIntegration };
