#!/bin/bash
set -e

echo "Renaming packages for GitHub registry..."

# Rename package name in packages/core/package.json
sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' packages/core/package.json

# Rename package name and dependency in packages/cli/package.json
sed -i 's#@google/gemini-cli-core#@google-gemini/gemini-cli-core#' packages/cli/package.json
sed -i 's#@google/gemini-cli"#@google-gemini/gemini-cli"#' packages/cli/package.json

# Create a temporary .npmrc for GitHub registry
echo "@google-gemini:registry=https://npm.pkg.github.com" > .npmrc

echo "Finished renaming packages."
