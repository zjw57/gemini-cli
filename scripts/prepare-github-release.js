/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function updatePackageJson(packagePath, updateFn) {
  const packageJsonPath = path.resolve(rootDir, packagePath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  updateFn(packageJson);
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

// Update @google/gemini-cli
updatePackageJson('packages/cli/package.json', (pkg) => {
  pkg.name = '@google-gemini/gemini-cli';
});

// Update @google/gemini-cli-a2a-server
updatePackageJson('packages/a2a-server/package.json', (pkg) => {
  pkg.name = '@google-gemini/gemini-cli-a2a-server';
});

// Update @google/gemini-cli-core
updatePackageJson('packages/core/package.json', (pkg) => {
  pkg.name = '@google-gemini/gemini-cli-core';
});

console.log('Successfully prepared packages for GitHub release.');
