/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packageDir = path.resolve(rootDir, 'package');
const bundleDir = path.resolve(rootDir, 'bundle');

function main() {
  console.log('Preparing bundled package for publishing...');

  // 1. Create the 'package' directory if it doesn't exist
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // 2. Read the root package.json
  const rootPackageJsonPath = path.resolve(rootDir, 'package.json');
  const rootPackageJson = JSON.parse(
    fs.readFileSync(rootPackageJsonPath, 'utf-8'),
  );

  // 3. Create a new package.json for the bundled package
  const newPackageJson = {
    name: '@google-gemini/gemini-cli', // This might be adjusted by rename-packages.sh
    version: rootPackageJson.version,
    description: 'Gemini CLI',
    repository: rootPackageJson.repository,
    type: 'module',
    bin: {
      gemini: 'bundle/gemini.js',
    },
    files: ['bundle/', 'README.md', 'LICENSE', '.npmrc'],
    engines: rootPackageJson.engines,
    optionalDependencies: rootPackageJson.optionalDependencies,
  };

  const newPackageJsonPath = path.resolve(packageDir, 'package.json');
  fs.writeFileSync(newPackageJsonPath, JSON.stringify(newPackageJson, null, 2));
  console.log(`Created ${newPackageJsonPath}`);

  // 4. Copy bundled files to the 'package' directory
  const destBundleDir = path.resolve(packageDir, 'bundle');
  fs.cpSync(bundleDir, destBundleDir, { recursive: true });
  console.log(`Copied ${bundleDir} to ${destBundleDir}`);

  // 5. Copy auxiliary files
  fs.copyFileSync(
    path.resolve(rootDir, 'README.md'),
    path.resolve(packageDir, 'README.md'),
  );
  fs.copyFileSync(
    path.resolve(rootDir, 'LICENSE'),
    path.resolve(packageDir, 'LICENSE'),
  );
  fs.copyFileSync(
    path.resolve(rootDir, '.npmrc'),
    path.resolve(packageDir, '.npmrc'),
  );
  console.log('Copied README.md, LICENSE, and .npmrc');

  console.log('✅ Successfully prepared package for publishing.');
}

main();
