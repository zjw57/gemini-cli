/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { Config } from '../config/config.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { makeRelative } from './paths.js';

/**
 * Options for resolving a tool path.
 */
export interface ResolvePathOptions {
  /** The raw path string provided by the LLM. */
  inputPath: string;
  /** The configuration object providing context (CWD, workspace roots). */
  config: Config;
  /** What type of filesystem object is expected. Defaults to 'either'. */
  expectedType?: 'file' | 'directory' | 'either';
  /** If true, does not check for existence (used for write_file). Defaults to false. */
  allowNonExistent?: boolean;
}

/**
 * The result of a path resolution attempt.
 */
export type ResolvePathResult =
  | {
      success: true;
      /** The validated, secure absolute path. */
      absolutePath: string;
      /** Information about how it was resolved. */
      resolutionMethod: 'direct' | 'search';
    }
  | {
      success: false;
      /** User-friendly error message for the LLM. */
      error: string;
      /** Structured error type. */
      errorType: ToolErrorType;
    };

/**
 * Helper to create a failure result.
 */
function createError(
  error: string,
  errorType: ToolErrorType,
): ResolvePathResult {
  return { success: false, error, errorType };
}

/**
 * Centralized utility to resolve, validate, and secure paths provided by the LLM.
 * Handles tilde expansion, relative paths, unambiguous smart resolution,
 * security boundary checks (symlink-aware), and type validation.
 */
export async function resolveToolPath(
  options: ResolvePathOptions,
): Promise<ResolvePathResult> {
  const {
    inputPath,
    config,
    expectedType = 'either',
    allowNonExistent = false,
  } = options;

  // 1. Input Sanitization
  if (!inputPath || inputPath.trim() === '') {
    return createError(
      'Path parameter must be non-empty.',
      ToolErrorType.INVALID_TOOL_PARAMS,
    );
  }

  // 2. Tilde Expansion
  let candidatePath = inputPath;
  if (candidatePath.startsWith('~/') || candidatePath === '~') {
    candidatePath = path.join(os.homedir(), candidatePath.slice(1));
  }

  // 3. Direct Resolution (Absolute or relative to CWD)
  if (!path.isAbsolute(candidatePath)) {
    candidatePath = path.resolve(config.getTargetDir(), candidatePath);
  }

  // 4. Existence & Unambiguous Search (if !allowNonExistent)
  let resolutionMethod: 'direct' | 'search' = 'direct';
  let exists = fs.existsSync(candidatePath);

  if (!exists && !allowNonExistent) {
    // Attempt unambiguous smart resolution
    const workspaceContext = config.getWorkspaceContext();
    const searchPaths = workspaceContext.getDirectories();
    const fileSystem = config.getFileSystemService();

    // findFiles performs a search within the workspace
    const matches = await fileSystem.findFiles(
      inputPath,
      searchPaths,
      expectedType,
    );

    if (matches.length === 0) {
      const relativeInput = makeRelative(inputPath, config.getTargetDir());
      return createError(
        `File or directory not found: '${relativeInput}'. Please verify the path using list_directory.`,
        ToolErrorType.FILE_NOT_FOUND,
      );
    } else if (matches.length > 1) {
      const relativeMatches = matches.map((m) =>
        makeRelative(m, config.getTargetDir()),
      );
      return createError(
        `Path is ambiguous. '${inputPath}' matches multiple files: [${relativeMatches.join(', ')}]. Please provide a more specific path.`,
        ToolErrorType.PATH_AMBIGUOUS,
      );
    } else {
      // Exactly one match found
      candidatePath = matches[0];
      resolutionMethod = 'search';
      exists = true;
    }
  }

  // 5. Security Boundary Check (Symlink Aware)
  // Determine the path to check for security.
  // If it exists, check the realpath.
  // If it doesn't exist (and is allowed), check its parent's realpath.
  let pathToCheckForSecurity: string;

  if (exists) {
    try {
      // Resolve symlinks to ensure we check the actual destination
      pathToCheckForSecurity = fs.realpathSync(candidatePath);
    } catch (_) {
      // Race condition: file deleted between exists check and realpath
      if (!allowNonExistent) {
        return createError(
          `File not found (lost during resolution): ${inputPath}`,
          ToolErrorType.FILE_NOT_FOUND,
        );
      }
      // If allowed to not exist, we will check the parent later.
      exists = false;
      pathToCheckForSecurity = path.dirname(candidatePath);
    }
  } else {
    // Doesn't exist, check parent for security
    const parent = path.dirname(candidatePath);

    // Try to resolve parent symlinks
    try {
      pathToCheckForSecurity = fs.realpathSync(parent);
    } catch (_) {
      // Parent doesn't exist or can't be resolved.
      // Check the unresolved parent path.
      pathToCheckForSecurity = parent;
    }
  }

  const workspaceContext = config.getWorkspaceContext();
  const projectTempDir = config.storage.getProjectTempDir();

  // Ensure temp dir is resolved for comparison
  let resolvedTempDir: string;
  try {
    resolvedTempDir = fs.existsSync(projectTempDir)
      ? fs.realpathSync(projectTempDir)
      : path.resolve(projectTempDir);
  } catch (_) {
    // Fallback if temp dir is inaccessible
    resolvedTempDir = path.resolve(projectTempDir);
  }

  const isInWorkspace = workspaceContext.isPathWithinWorkspace(
    pathToCheckForSecurity,
  );
  let isInTemp = false;
  if (!isInWorkspace) {
    const rel = path.relative(resolvedTempDir, pathToCheckForSecurity);
    isInTemp = !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  if (!isInWorkspace && !isInTemp) {
    const allowedDirs = [
      ...workspaceContext.getDirectories(),
      projectTempDir,
    ].join(', ');
    return createError(
      `Security Error: Path '${makeRelative(candidatePath, config.getTargetDir())}' resolves outside allowed workspace directories (${allowedDirs}).`,
      ToolErrorType.PATH_NOT_IN_WORKSPACE,
    );
  }

  // 6. Type Validation (if exists)
  if (exists) {
    // Re-stat the secure path
    try {
      const stats = fs.statSync(pathToCheckForSecurity);
      if (expectedType === 'file' && stats.isDirectory()) {
        return createError(
          `Path is a directory, expected a file: ${inputPath}`,
          ToolErrorType.TARGET_IS_DIRECTORY,
        );
      }
      if (expectedType === 'directory' && !stats.isDirectory()) {
        return createError(
          `Path is a file, expected a directory: ${inputPath}`,
          ToolErrorType.PATH_IS_NOT_A_DIRECTORY,
        );
      }
    } catch (_) {
      // Race condition handling
      if (!allowNonExistent) {
        return createError(
          `Failed to access path: ${inputPath}`,
          ToolErrorType.FILE_NOT_FOUND,
        );
      }
    }
  }

  // 7. Parent Validation for Non-Existent Paths (e.g., write_file)
  if (!exists && allowNonExistent) {
    const parent = path.dirname(candidatePath);
    // Security of parent is already checked in Step 5.
    // We just need to ensure it exists and is a directory so writing can succeed
    // (or explicitly fail if we don't want to allow mkdir -p behavior here).
    // Current write_file does mkdir -p, so we don't strictly need to fail here,
    // but we must ensure the parent isn't a file.
    if (fs.existsSync(parent)) {
      const parentStats = fs.statSync(parent);
      if (!parentStats.isDirectory()) {
        return createError(
          `Cannot create file, parent path is not a directory: ${makeRelative(parent, config.getTargetDir())}`,
          ToolErrorType.PATH_IS_NOT_A_DIRECTORY,
        );
      }
    }
    // If parent doesn't exist, write_file handles mkdir -p.
    // Security is already verified.
  }

  return {
    success: true,
    absolutePath: exists ? pathToCheckForSecurity : candidatePath,
    resolutionMethod,
  };
}
