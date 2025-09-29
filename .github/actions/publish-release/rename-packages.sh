#!/bin/bash
set -e

echo "Renaming packages for GitHub registry..."

# Rename package name in packages/core/package.json
sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' packages/core/package.json

# Rename package name and dependency in packages/cli/package.json
sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' packages/cli/package.json
sed -i 's#@google/gemini-cli"#@google-gemini/gemini-cli"#' packages/cli/package.json

# Update imports in source code
find packages/cli/src -type f -name "*.ts" -exec sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' {} +

# Move directory in node_modules
mkdir -p node_modules/@google-gemini
mv node_modules/@google/gemini-cli-core node_modules/@google-gemini/gemini-cli-core

# Create a temporary .npmrc for GitHub registry
echo "@google-gemini:registry=https://npm.pkg.github.com" > .npmrc

echo "Finished renaming packages."
