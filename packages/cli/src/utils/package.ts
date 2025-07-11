/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  readPackageUp,
  type PackageJson as BasePackageJson,
} from 'read-package-up';
import { fileURLToPath } from 'url';
import path from 'path';

export type PackageJson = BasePackageJson & {
  config?: {
    sandboxImageUri?: string;
  };
};

// This is a little tricky.
//
// In a normal ESM module, we can use `import.meta.url` to get the
// location of the current file.
//
// However, when this code is bundled by esbuild and run in a CJS
// context (like in the Electron app), `import.meta.url` is not
// available, but `__dirname` is.
//
// To handle both cases, we'll try to use `__dirname` if it's
// available, and fall back to the `import.meta.url` method if it's not.
let aPath: string;
try {
  aPath = __dirname;
} catch (e) {
  const __filename = fileURLToPath(import.meta.url);
  aPath = path.dirname(__filename);
}

let packageJson: PackageJson | undefined;

export async function getPackageJson(): Promise<PackageJson | undefined> {
  if (packageJson) {
    return packageJson;
  }

  const result = await readPackageUp({ cwd: aPath });
  if (!result) {
    // TODO: Maybe bubble this up as an error.
    return;
  }

  packageJson = result.packageJson;
  return packageJson;
}
