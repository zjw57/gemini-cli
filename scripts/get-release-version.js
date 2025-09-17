#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function getLatestTag(pattern) {
  // Use git's built-in sorting by creation date to find the most recent tag.
  const command = `git tag --sort=-creatordate -l '${pattern}' | head -n 1`;
  try {
    return execSync(command).toString().trim();
  } catch {
    return '';
  }
}

function getVersionFromNPM(distTag) {
  const command = `npm view @google/gemini-cli version --tag=${distTag}`;
  try {
    return execSync(command).toString().trim();
  } catch {
    return '';
  }
}

function verifyGitHubReleaseExists(tagName) {
  const command = `gh release view "${tagName}" --json tagName --jq .tagName`;
  try {
    const output = execSync(command).toString().trim();
    if (output !== tagName) {
      throw new Error(
        `Discrepancy found! NPM version ${tagName} is missing a corresponding GitHub release.`,
      );
    }
  } catch (error) {
    throw new Error(
      `Discrepancy found! Failed to verify GitHub release for ${tagName}. Error: ${error.message}`,
    );
  }
}

export function getVersion(options = {}) {
  const args = getArgs();
  const type = options.type || args.type || 'nightly';

  let releaseVersion;
  let npmTag;
  let previousReleaseTag;

  if (type === 'nightly') {
    const latestNightlyVersion = getVersionFromNPM('nightly');
    const latestNightlyTag = getLatestTag('v*-nightly*');
    if (`v${latestNightlyVersion}` !== latestNightlyTag) {
      throw new Error(
        `Discrepancy found! NPM nightly tag (${latestNightlyVersion}) does not match latest git nightly tag (${latestNightlyTag}).`,
      );
    }
    verifyGitHubReleaseExists(latestNightlyTag);

    const baseVersion = latestNightlyVersion.split('-')[0];
    const versionParts = baseVersion.split('.');
    const major = versionParts[0];
    const minor = versionParts[1] ? parseInt(versionParts[1]) : 0;
    const nextMinor = minor + 1;

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const gitShortHash = execSync('git rev-parse --short HEAD')
      .toString()
      .trim();

    releaseVersion = `${major}.${nextMinor}.0-nightly.${date}.${gitShortHash}`;
    npmTag = 'nightly';
    previousReleaseTag = latestNightlyTag;
  } else if (type === 'stable') {
    const latestPreviewVersion = getVersionFromNPM('preview');
    const latestPreviewTag = getLatestTag('v*-preview*');
    if (`v${latestPreviewVersion}` !== latestPreviewTag) {
      throw new Error(
        `Discrepancy found! NPM preview tag (${latestPreviewVersion}) does not match latest git preview tag (${latestPreviewTag}).`,
      );
    }
    verifyGitHubReleaseExists(latestPreviewTag);

    releaseVersion = latestPreviewVersion.replace(/-preview.*/, '');
    npmTag = 'latest';
    previousReleaseTag = getLatestTag('v[0-9].[0-9].[0-9]');
  } else if (type === 'preview') {
    const latestNightlyVersion = getVersionFromNPM('nightly');
    const latestNightlyTag = getLatestTag('v*-nightly*');
    if (`v${latestNightlyVersion}` !== latestNightlyTag) {
      throw new Error(
        `Discrepancy found! NPM nightly tag (${latestNightlyVersion}) does not match latest git nightly tag (${latestNightlyTag}).`,
      );
    }
    verifyGitHubReleaseExists(latestNightlyTag);

    releaseVersion =
      latestNightlyVersion.replace(/-nightly.*/, '') + '-preview';
    npmTag = 'preview';
    previousReleaseTag = getLatestTag('v*-preview*');
  } else if (type === 'patch') {
    const patchFrom = options.patchFrom || args.patchFrom;
    if (!patchFrom || (patchFrom !== 'stable' && patchFrom !== 'preview')) {
      throw new Error(
        'Patch type must be specified with --patch-from=stable or --patch-from=preview',
      );
    }

    const distTag = patchFrom === 'stable' ? 'latest' : 'preview';
    const latestVersion = getVersionFromNPM(distTag);
    const pattern = distTag === 'latest' ? 'v[0-9].[0-9].[0-9]' : 'v*-preview*';
    previousReleaseTag = getLatestTag(pattern);
    if (`v${latestVersion}` !== previousReleaseTag) {
      throw new Error(
        `Discrepancy found! NPM ${distTag} tag (${latestVersion}) does not match latest git tag (${previousReleaseTag}).`,
      );
    }
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
