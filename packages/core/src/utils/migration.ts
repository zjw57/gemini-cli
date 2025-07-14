/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GEMINI_DIR } from './paths.js';

const INTERNAL_DIR = 'internal';

/**
 * Get the path to the internal directory within .gemini
 */
export function getInternalDir(): string {
  return path.join(os.homedir(), GEMINI_DIR, INTERNAL_DIR);
}

/**
 * Ensures the internal directory exists
 */
export function ensureInternalDirExists(): void {
  const internalDir = getInternalDir();
  if (!fs.existsSync(internalDir)) {
    fs.mkdirSync(internalDir, { recursive: true });
  }
}

/**
 * Migrates a file from the old location to the new location
 * @param oldPath The current path of the file
 * @param newPath The new path where the file should be moved
 * @returns true if migration was performed, false if no migration was needed
 */
function migrateFile(oldPath: string, newPath: string): boolean {
  try {
    if (fs.existsSync(oldPath)) {
      ensureInternalDirExists();

      if (fs.existsSync(newPath)) {
        // If both paths exist, remove the old file
        fs.rmSync(oldPath);
        console.debug(
          `Removed duplicate file ${path.basename(oldPath)} from old location`,
        );
      } else {
        // If only old path exists, migrate it
        fs.renameSync(oldPath, newPath);
        console.debug(
          `Migrated ${path.basename(oldPath)} to internal directory`,
        );
      }
      return true;
    }
    return false;
  } catch (error) {
    console.debug(`Failed to migrate ${path.basename(oldPath)}:`, error);
    return false;
  }
}

/**
 * Migrates all files from the data directory to the internal directory
 * and cleans up the empty data directory afterwards
 */
function migrateDataDirectory(): void {
  const geminiDir = path.join(os.homedir(), GEMINI_DIR);
  const dataDir = path.join(geminiDir, 'data');
  const internalDir = getInternalDir();

  try {
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);

      // Migrate any remaining files from data to internal directory
      for (const file of files) {
        const oldPath = path.join(dataDir, file);
        const newPath = path.join(internalDir, file);
        migrateFile(oldPath, newPath);
      }

      // After migration, check if directory is empty and remove it
      const remainingFiles = fs.readdirSync(dataDir);
      if (remainingFiles.length === 0) {
        fs.rmdirSync(dataDir);
        console.debug('Removed empty data directory');
      }
    }
  } catch (_error) {
    // Ignore errors when cleaning up
  }
}

/**
 * Performs migration of internal files to the internal subdirectory
 * This function is idempotent and can be called multiple times safely
 */
export function migrateInternalFiles(): void {
  const geminiDir = path.join(os.homedir(), GEMINI_DIR);
  const internalDir = getInternalDir();

  const filesToMigrate = [
    {
      filename: 'installation_id',
      oldPath: path.join(geminiDir, 'installation_id'),
      newPath: path.join(internalDir, 'installation_id'),
    },
    {
      filename: 'google_accounts.json',
      oldPath: path.join(geminiDir, 'google_accounts.json'),
      newPath: path.join(internalDir, 'google_accounts.json'),
    },
    {
      filename: 'oauth_creds.json',
      oldPath: path.join(geminiDir, 'oauth_creds.json'),
      newPath: path.join(internalDir, 'oauth_creds.json'),
    },
  ];

  for (const file of filesToMigrate) {
    migrateFile(file.oldPath, file.newPath);
  }

  migrateDataDirectory();
}

/**
 * Gets the installation ID file path, checking both old and new locations
 * @returns The path to the installation_id file
 */
export function getInstallationIdPath(): string {
  const internalPath = path.join(getInternalDir(), 'installation_id');
  const legacyPath = path.join(os.homedir(), GEMINI_DIR, 'installation_id');
  migrateInternalFiles();
  if (fs.existsSync(internalPath)) {
    return internalPath;
  }

  if (fs.existsSync(legacyPath)) {
    return internalPath;
  }

  return internalPath;
}

/**
 * Gets the Google accounts file path, checking both old and new locations
 * @returns The path to the google_accounts.json file
 */
export function getGoogleAccountsPath(): string {
  const internalPath = path.join(getInternalDir(), 'google_accounts.json');
  const legacyPath = path.join(
    os.homedir(),
    GEMINI_DIR,
    'google_accounts.json',
  );
  migrateInternalFiles();

  if (fs.existsSync(internalPath)) {
    return internalPath;
  }

  if (fs.existsSync(legacyPath)) {
    return internalPath;
  }

  return internalPath;
}

/**
 * Gets the OAuth credentials file path, checking both old and new locations
 * @returns The path to the oauth_creds.json file
 */
export function getOAuthCredsPath(): string {
  const internalPath = path.join(getInternalDir(), 'oauth_creds.json');
  const legacyPath = path.join(os.homedir(), GEMINI_DIR, 'oauth_creds.json');
  migrateInternalFiles();

  if (fs.existsSync(internalPath)) {
    return internalPath;
  }

  if (fs.existsSync(legacyPath)) {
    return internalPath;
  }

  return internalPath;
}
