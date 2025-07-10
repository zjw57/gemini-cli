/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readPackageUp } from 'read-package-up';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getPackageJson() {
  const result = await readPackageUp({ cwd: __dirname });
  if (!result) {
    return;
  }
  return result.packageJson;
}