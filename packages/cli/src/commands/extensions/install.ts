/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingScope } from '../../config/settings.js';
import { installExtension } from '../../config/extension.js';

interface InstallArgs {
  source?: string;
  path?: string;
  scope?: SettingScope;
}

export async function handleInstall(args: InstallArgs) {
  try {
    const extensionName = await installExtension(args);
    console.log(
      `Extension "${extensionName}" installed successfully and enabled for ${args.scope}.`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
