/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Options } from 'yargs';
import {
  SettingsManager,
  ExtensionMetadata,
} from '../config/settings-manager.js';

export const scopeOption: Options = {
  alias: 's',
  describe: 'Configuration scope (user or project)',
  type: 'string',
  default: 'project',
  choices: ['user', 'project'],
};

export async function findExtensionInScopes(name: string): Promise<{
  extension: ExtensionMetadata;
  settingsManager: SettingsManager;
} | null> {
  // Check user scope first
  const userSettingsManager = new SettingsManager('user');
  let extension = await userSettingsManager.getExtension(name);

  if (extension) {
    return { extension, settingsManager: userSettingsManager };
  }

  // Check project scope
  const projectSettingsManager = new SettingsManager('project');
  extension = await projectSettingsManager.getExtension(name);

  if (extension) {
    return { extension, settingsManager: projectSettingsManager };
  }

  return null;
}
