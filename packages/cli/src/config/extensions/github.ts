/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { simpleGit } from 'simple-git';
import { getErrorMessage } from '../../utils/errors.js';
import type {
  ExtensionInstallMetadata,
  GeminiCLIExtension,
} from '@google/gemini-cli-core';
import { ExtensionUpdateState } from '../../ui/state/extensions.js';
import * as os from 'node:os';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { loadExtension } from '../extension.js';

function getGitHubToken(): string | undefined {
  return process.env['GITHUB_TOKEN'];
}

/**
 * Clones a Git repository to a specified local path.
 * @param installMetadata The metadata for the extension to install.
 * @param destination The destination path to clone the repository to.
 */
export async function cloneFromGit(
  installMetadata: ExtensionInstallMetadata,
  destination: string,
): Promise<void> {
  try {
    const git = simpleGit(destination);
    let sourceUrl = installMetadata.source;
    const token = getGitHubToken();
    if (token) {
      try {
        const parsedUrl = new URL(sourceUrl);
        if (
          parsedUrl.protocol === 'https:' &&
          parsedUrl.hostname === 'github.com'
        ) {
          if (!parsedUrl.username) {
            parsedUrl.username = token;
          }
          sourceUrl = parsedUrl.toString();
        }
      } catch {
        // If source is not a valid URL, we don't inject the token.
        // We let git handle the source as is.
      }
    }
    await git.clone(sourceUrl, './', ['--depth', '1']);

    const remotes = await git.getRemotes(true);
    if (remotes.length === 0) {
      throw new Error(
        `Unable to find any remotes for repo ${installMetadata.source}`,
      );
    }

    let refToFetch = installMetadata.ref;
    if (!refToFetch) {
      try {
        const { owner, repo } = parseGitHubRepoForReleases(
          installMetadata.source,
        );
        const releaseData = await fetchFromGithub(owner, repo);
        refToFetch = releaseData.tag_name;
      } catch {
        // If we can't fetch the latest release, we'll just use HEAD.
        refToFetch = 'HEAD';
      }
    }

    await git.fetch(remotes[0].name, refToFetch);

    // After fetching, checkout FETCH_HEAD to get the content of the fetched ref.
    // This results in a detached HEAD state, which is fine for this purpose.
    await git.checkout('FETCH_HEAD');
  } catch (error) {
    throw new Error(
      `Failed to clone Git repository from ${installMetadata.source}`,
      {
        cause: error,
      },
    );
  }
}

export function parseGitHubRepoForReleases(source: string): {
  owner: string;
  repo: string;
} {
  // Default to a github repo path, so `source` can be just an org/repo
  const parsedUrl = URL.parse(source, 'https://github.com');
  // The pathname should be "/owner/repo".
  const parts = parsedUrl?.pathname.substring(1).split('/');
  if (parts?.length !== 2) {
    throw new Error(
      `Invalid GitHub repository source: ${source}. Expected "owner/repo" or a github repo uri.`,
    );
  }
  const owner = parts[0];
  const repo = parts[1].replace('.git', '');

  if (owner.startsWith('git@github.com')) {
    throw new Error(
      `GitHub release-based extensions are not supported for SSH. You must use an HTTPS URI with a personal access token to download releases from private repositories. You can set your personal access token in the GITHUB_TOKEN environment variable and install the extension via SSH.`,
    );
  }

  return { owner, repo };
}

async function fetchFromGithub(
  owner: string,
  repo: string,
  ref?: string,
): Promise<{ assets: Asset[]; tag_name: string }> {
  const endpoint = ref ? `releases/tags/${ref}` : 'releases/latest';
  const url = `https://api.github.com/repos/${owner}/${repo}/${endpoint}`;
  return await fetchJson(url);
}

export async function checkForExtensionUpdate(
  extension: GeminiCLIExtension,
  setExtensionUpdateState: (updateState: ExtensionUpdateState) => void,
  cwd: string = process.cwd(),
): Promise<void> {
  setExtensionUpdateState(ExtensionUpdateState.CHECKING_FOR_UPDATES);
  const installMetadata = extension.installMetadata;
  if (installMetadata?.type === 'local') {
    const newExtension = loadExtension({
      extensionDir: installMetadata.source,
      workspaceDir: cwd,
    });
    if (!newExtension) {
      console.error(
        `Failed to check for update for local extension "${extension.name}". Could not load extension from source path: ${installMetadata.source}`,
      );
      setExtensionUpdateState(ExtensionUpdateState.ERROR);
      return;
    }
    if (newExtension.config.version !== extension.version) {
      setExtensionUpdateState(ExtensionUpdateState.UPDATE_AVAILABLE);
      return;
    }
    setExtensionUpdateState(ExtensionUpdateState.UP_TO_DATE);
    return;
  }
  if (
    !installMetadata ||
    (installMetadata.type !== 'git' &&
      installMetadata.type !== 'github-release')
  ) {
    setExtensionUpdateState(ExtensionUpdateState.NOT_UPDATABLE);
    return;
  }
  try {
    if (installMetadata.type === 'git') {
      const git = simpleGit(extension.path);
      const remotes = await git.getRemotes(true);
      if (remotes.length === 0) {
        console.error('No git remotes found.');
        setExtensionUpdateState(ExtensionUpdateState.ERROR);
        return;
      }
      const remoteUrl = remotes[0].refs.fetch;
      if (!remoteUrl) {
        console.error(`No fetch URL found for git remote ${remotes[0].name}.`);
        setExtensionUpdateState(ExtensionUpdateState.ERROR);
        return;
      }

      // Determine the ref to check on the remote.
      const refToCheck = installMetadata.ref || 'HEAD';

      const lsRemoteOutput = await git.listRemote([remoteUrl, refToCheck]);

      if (typeof lsRemoteOutput !== 'string' || lsRemoteOutput.trim() === '') {
        console.error(`Git ref ${refToCheck} not found.`);
        setExtensionUpdateState(ExtensionUpdateState.ERROR);
        return;
      }

      const remoteHash = lsRemoteOutput.split('\t')[0];
      const localHash = await git.revparse(['HEAD']);

      if (!remoteHash) {
        console.error(
          `Unable to parse hash from git ls-remote output "${lsRemoteOutput}"`,
        );
        setExtensionUpdateState(ExtensionUpdateState.ERROR);
        return;
      }
      if (remoteHash === localHash) {
        setExtensionUpdateState(ExtensionUpdateState.UP_TO_DATE);
        return;
      }
      setExtensionUpdateState(ExtensionUpdateState.UPDATE_AVAILABLE);
      return;
    } else {
      const { source, ref } = installMetadata;
      if (!source) {
        console.error(`No "source" provided for extension.`);
        setExtensionUpdateState(ExtensionUpdateState.ERROR);
        return;
      }
      const { owner, repo } = parseGitHubRepoForReleases(source);

      const releaseData = await fetchFromGithub(
        owner,
        repo,
        installMetadata.ref,
      );
      if (releaseData.tag_name !== ref) {
        setExtensionUpdateState(ExtensionUpdateState.UPDATE_AVAILABLE);
        return;
      }
      setExtensionUpdateState(ExtensionUpdateState.UP_TO_DATE);
      return;
    }
  } catch (error) {
    console.error(
      `Failed to check for updates for extension "${installMetadata.source}": ${getErrorMessage(error)}`,
    );
    setExtensionUpdateState(ExtensionUpdateState.ERROR);
    return;
  }
}

export async function downloadFromGitHubRelease(
  installMetadata: ExtensionInstallMetadata,
  destination: string,
): Promise<string> {
  const { source, ref } = installMetadata;
  const { owner, repo } = parseGitHubRepoForReleases(source);

  try {
    const releaseData = await fetchFromGithub(owner, repo, ref);
    if (!releaseData) {
      throw new Error(
        `No release data found for ${owner}/${repo} at tag ${ref}`,
      );
    }

    const asset = findReleaseAsset(releaseData.assets);
    if (!asset) {
      // If there are no release assets, then we just clone the repo using the
      // ref the release points to.
      await cloneFromGit(
        {
          ...installMetadata,
          ref: releaseData.tag_name,
        },
        destination,
      );
      return releaseData.tag_name;
    }

    const downloadedAssetPath = path.join(destination, asset.name);
    const downloadUrl = asset.url;
    await downloadFile(downloadUrl, downloadedAssetPath);

    extractFile(downloadedAssetPath, destination);

    const files = await fs.promises.readdir(destination);
    const extractedDirName = files.find((file) => {
      const filePath = path.join(destination, file);
      return fs.statSync(filePath).isDirectory();
    });

    if (extractedDirName) {
      const extractedDirPath = path.join(destination, extractedDirName);
      const extractedDirFiles = await fs.promises.readdir(extractedDirPath);
      for (const file of extractedDirFiles) {
        await fs.promises.rename(
          path.join(extractedDirPath, file),
          path.join(destination, file),
        );
      }
      await fs.promises.rmdir(extractedDirPath);
    }

    await fs.promises.unlink(downloadedAssetPath);
    return releaseData.tag_name;
  } catch (error) {
    throw new Error(
      `Failed to download release from ${installMetadata.source}: ${getErrorMessage(error)}`,
    );
  }
}

interface Asset {
  name: string;
  url: string;
}

export function findReleaseAsset(assets: Asset[]): Asset | undefined {
  const platform = os.platform();
  const arch = os.arch();

  const platformArchPrefix = `${platform}.${arch}.`;
  const platformPrefix = `${platform}.`;

  // Check for platform + architecture specific asset
  const platformArchAsset = assets.find((asset) =>
    asset.name.toLowerCase().startsWith(platformArchPrefix),
  );
  if (platformArchAsset) {
    return platformArchAsset;
  }

  // Check for platform specific asset
  const platformAsset = assets.find((asset) =>
    asset.name.toLowerCase().startsWith(platformPrefix),
  );
  if (platformAsset) {
    return platformAsset;
  }

  // Check for generic asset if only one is available
  const genericAsset = assets.find(
    (asset) =>
      !asset.name.toLowerCase().includes('darwin') &&
      !asset.name.toLowerCase().includes('linux') &&
      !asset.name.toLowerCase().includes('win32'),
  );
  if (assets.length === 1) {
    return genericAsset;
  }

  return undefined;
}

/**
 * Fetches JSON from a URL, handling auth and redirects.
 */
async function fetchJson(
  url: string,
): Promise<{ assets: Asset[]; tag_name: string }> {
  const headers: {
    'User-Agent': string;
    Authorization?: string;
    Accept: string;
  } = {
    'User-Agent': 'gemini-cli',
    Accept: 'application/vnd.github+json',
  };
  const token = getGitHubToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    console.log('GITHUB_TOKEN is missing.');
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (res) => {
      if (
        (res.statusCode === 301 || res.statusCode === 302) &&
        res.headers.location
      ) {
        fetchJson(res.headers.location).then(resolve).catch(reject);
        return;
      }

      // Check for non-200 status
      if (res.statusCode !== 200) {
        // Read the error body from GitHub for a detailed message
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const errorBody = Buffer.concat(chunks).toString();
          reject(
            new Error(
              `Request failed with status code ${res.statusCode} ${res.statusMessage}. Body: ${errorBody}`,
            ),
          );
        });
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString();
          resolve(JSON.parse(data) as { assets: Asset[]; tag_name: string });
        } catch (e) {
          reject(
            new Error(
              `Failed to parse JSON response from ${url}: ${getErrorMessage(e)}`,
            ),
          );
        }
      });
    });

    request.on('error', (err) => {
      reject(
        new Error(`HTTPS request failed for ${url}: ${getErrorMessage(err)}`),
      );
    });
  });
}

/**
 * Downloads a file from a URL using native https, handling auth and redirects.
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  const token = getGitHubToken();
  const parsedUrl = new URL(url);

  const options: https.RequestOptions = {
    headers: {
      'User-Agent': 'gemini-cli',
    },
  };

  if (token && parsedUrl.hostname === 'api.github.com') {
    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
    };
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, options, (res) => {
      // Handle redirects (this is the main flow for asset downloads)
      if (
        (res.statusCode === 301 || res.statusCode === 302) &&
        res.headers.location
      ) {
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        return reject(
          new Error(
            `Download failed with status code ${res.statusCode}: ${res.statusMessage}`,
          ),
        );
      }

      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(dest, () => {}); // Clean up broken file
        reject(new Error(`Failed to write to file: ${getErrorMessage(err)}`));
      });
    });

    request.on('error', (err) => {
      reject(new Error(`Download request failed: ${getErrorMessage(err)}`));
    });
  });
}

function extractFile(file: string, dest: string) {
  if (file.endsWith('.tar.gz')) {
    execSync(`tar -xzf ${file} -C ${dest}`);
  } else if (file.endsWith('.zip')) {
    execSync(`unzip ${file} -d ${dest}`);
  } else {
    throw new Error(`Unsupported file extension for extraction: ${file}`);
  }
}
