#!/bin/bash
set -e

echo "Renaming packages for GitHub registry..."

# --- DEBUG: List files with the old string BEFORE replacement ---
echo "--- Files containing '@google/gemini-cli-core' before replacement ---"
find packages/cli/src -type f -name "*.ts" -exec grep -l "@google/gemini-cli-core" {} + || echo "No files found with old string."
echo "----------------------------------------------------------------"

# Rename package name in packages/core/package.json
sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' packages/core/package.json

# Rename package name and dependency in packages/cli/package.json
sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' packages/cli/package.json
sed -i 's#@google/gemini-cli"#@google-gemini/gemini-cli"#' packages/cli/package.json

# Update imports in source code
find packages/cli/src -type f -name "*.ts" -exec sed -i -E "s/(from\s+['\"])(@google\/gemini-cli-core)/\1@google-gemini\/gemini-cli-core/g" {} +

# --- DEBUG: List files with the new string AFTER replacement ---
echo "--- Files containing '@google-gemini/gemini-cli-core' after replacement ---"
find packages/cli/src -type f -name "*.ts" -exec grep -l "@google-gemini/gemini-cli-core" {} + || echo "No files found with new string."
echo "-----------------------------------------------------------------"

# --- DEBUG: Check for any remaining files with the old string ---
echo "--- Files STILL containing '@google/gemini-cli-core' after replacement (should be empty) ---"
find packages/cli/src -type f -name "*.ts" -exec grep -l "@google/gemini-cli-core" {} + || echo "No files found with old string. Success!"
echo "---------------------------------------------------------------------------------------"

# Move directory in node_modules
mkdir -p node_modules/@google-gemini
mv node_modules/@google/gemini-cli-core node_modules/@google-gemini/gemini-cli-core

# Create a temporary .npmrc for GitHub registry
echo "@google-gemini:registry=https://npm.pkg.github.com" > .npmrc

echo "Finished renaming packages."
