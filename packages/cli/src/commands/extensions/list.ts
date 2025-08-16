/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini extensions list' command
import type { CommandModule } from 'yargs';
import { SettingsManager } from '../../config/settings-manager.js';
import { loadExtensions } from '../../config/extension.js';

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'List all installed extensions',
  handler: async () => {
    const settingsManager = new SettingsManager();
    const managedExtensions = await settingsManager.getInstalledExtensions();
    const allExtensions = loadExtensions(process.cwd());

    const managedExtensionsMap = new Map(
      managedExtensions.map((ext) => [ext.name, ext]),
    );

    console.log('Configured extensions:\n');

    if (allExtensions.length === 0) {
      console.log('No extensions installed.');
      return;
    }

    for (const extension of allExtensions) {
      const managedExtension = managedExtensionsMap.get(extension.config.name);
      const status = managedExtension
        ? managedExtension.active
          ? 'active'
          : 'inactive'
        : 'active (unmanaged)';
      const scope = managedExtension ? managedExtension.scope : 'unknown';
      console.log(
        `- ${extension.config.name} (v${extension.config.version}) - ${status} [${scope}]`,
      );
    }
  },
};
