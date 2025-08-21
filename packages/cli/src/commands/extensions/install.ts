/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installExtension } from '../../config/extension.js';

interface InstallArgs {
  source?: string;
  path?: string;
}

export async function handleInstall(args: InstallArgs) {
  try {
    const extensionName = await installExtension(args);
    console.log(
      `Extension "${extensionName}" installed successfully and enabled.`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
