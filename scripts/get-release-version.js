#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      args[key] = value === undefined ? true : value;
    }
  });
  return args;
}

function getLatestTagFromNPM(distTag) {
  const command = `npm view @google/gemini-cli version --json --tag=${distTag}`;
  try {
    return execSync(command).toString().trim();
  } catch {
    return '';
  }
}

function verifyGitTagExists(tagName) {
  const command = `git tag -l "${tagName}"`;
  const output = execSync(command).toString().trim();
  if (!output) {
    throw new Error(`Discrepancy found! NPM version ${tagName} is missing a corresponding git tag.`);
  }
}

function verifyGitHubReleaseExists(tagName) {
  const command = `gh release view "${tagName}" --json tagName --jq .tagName`;
  try {
    const output = execSync(command).toString().trim();
    if (output !== tagName) {
      throw new Error(`Discrepancy found! NPM version ${tagName} is missing a corresponding GitHub release.`);
    }
  } catch (error) {
    throw new Error(`Discrepancy found! Failed to verify GitHub release for ${tagName}. Error: ${error.message}`);
  }
}

export function getVersion(options = {}) {
  const args = getArgs();
  const type = options.type || args.type || 'nightly';

  let releaseVersion;
  let npmTag;
  let previousReleaseTag;

  if (type === 'nightly') {
    const latestStableVersion = getLatestTagFromNPM('latest');
    verifyGitTagExists(`v${latestStableVersion}`);
    verifyGitHubReleaseExists(`v${latestStableVersion}`);
    
    const versionParts = latestStableVersion.split('.');
    const major = versionParts[0];
    const minor = versionParts[1] ? parseInt(versionParts[1]) : 0;
    const nextMinor = minor + 1;
    
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const gitShortHash = execSync('git rev-parse --short HEAD').toString().trim();
    
    releaseVersion = `${major}.${nextMinor}.0-nightly.${date}.${gitShortHash}`;
    npmTag = 'nightly';
    previousReleaseTag = `v${getLatestTagFromNPM('nightly')}`;
  } else if (type === 'stable') {
    const latestPreviewVersion = getLatestTagFromNPM('preview');
    verifyGitTagExists(`v${latestPreviewVersion}`);
    verifyGitHubReleaseExists(`v${latestPreviewVersion}`);

    releaseVersion = latestPreviewVersion.replace(/-preview.*/, '');
    npmTag = 'latest';
    previousReleaseTag = `v${getLatestTagFromNPM('latest')}`;
  } else if (type === 'preview') {
    const latestNightlyVersion = getLatestTagFromNPM('nightly');
    verifyGitTagExists(`v${latestNightlyVersion}`);
    verifyGitHubReleaseExists(`v${latestNightlyVersion}`);

    releaseVersion = latestNightlyVersion.replace(/-nightly.*/, '') + '-preview';
    npmTag = 'preview';
    previousReleaseTag = `v${getLatestTagFromNPM('preview')}`;
  } else if (type === 'patch') {
    const patchFrom = options.patchFrom || args.patchFrom;
    if (!patchFrom || (patchFrom !== 'stable' && patchFrom !== 'preview')) {
      throw new Error('Patch type must be specified with --patch-from=stable or --patch-from=preview');
    }

    const distTag = patchFrom === 'stable' ? 'latest' : 'preview';
    const latestVersion = getLatestTagFromNPM(distTag);
    previousReleaseTag = `v${latestVersion}`;
    verifyGitTagExists(previousReleaseTag);
    verifyGitHubReleaseExists(previousReleaseTag);

    const [version, ...prereleaseParts] = latestVersion.split('-');
    const prerelease = prereleaseParts.join('-');
    const versionParts = version.split('.');
    const major = versionParts[0];
    const minor = versionParts[1];
    const patch = versionParts[2] ? parseInt(versionParts[2]) : 0;
    
    if (prerelease) {
      releaseVersion = `${major}.${minor}.${patch + 1}-${prerelease}`;
    } else {
      releaseVersion = `${major}.${minor}.${patch + 1}`;
    }
    npmTag = distTag;
  }

  const releaseTag = `v${releaseVersion}`;

  return {
    releaseTag,
    releaseVersion,
    npmTag,
    previousReleaseTag,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(getVersion(), null, 2));
}