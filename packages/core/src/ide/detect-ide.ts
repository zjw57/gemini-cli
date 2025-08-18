/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIdeProcessInfo } from './process-utils.js';

export enum DetectedIde {
  Devin = 'devin',
  Replit = 'replit',
  VSCode = 'vscode',
  VSCodeFork = 'vscode-fork',
  Cursor = 'cursor',
  CloudShell = 'cloudshell',
  Codespaces = 'codespaces',
  FirebaseStudio = 'firebasestudio',
  Trae = 'trae',
}

export interface IdeInfo {
  displayName: string;
}

export function getIdeInfo(ide: DetectedIde): IdeInfo {
  switch (ide) {
    case DetectedIde.Devin:
      return {
        displayName: 'Devin',
      };
    case DetectedIde.Replit:
      return {
        displayName: 'Replit',
      };
    case DetectedIde.VSCode:
      return {
        displayName: 'VS Code',
      };
    case DetectedIde.VSCodeFork:
      return {
        displayName: 'IDE',
      };
    case DetectedIde.Cursor:
      return {
        displayName: 'Cursor',
      };
    case DetectedIde.CloudShell:
      return {
        displayName: 'Cloud Shell',
      };
    case DetectedIde.Codespaces:
      return {
        displayName: 'GitHub Codespaces',
      };
    case DetectedIde.FirebaseStudio:
      return {
        displayName: 'Firebase Studio',
      };
    case DetectedIde.Trae:
      return {
        displayName: 'Trae',
      };
    default: {
      // This ensures that if a new IDE is added to the enum, we get a compile-time error.
      const exhaustiveCheck: never = ide;
      return exhaustiveCheck;
    }
  }
}

export async function detectIde(): Promise<DetectedIde | undefined> {
  // Only VSCode-based integrations are currently supported.
  if (process.env['TERM_PROGRAM'] !== 'vscode') {
    return undefined;
  }

  try {
    const { command } = await getIdeProcessInfo();
    const lowerCaseCommand = command.toLowerCase();

    // Check for IDEs based on the command string.
    // The order is important as some commands might be substrings of others.
    if (lowerCaseCommand.includes('devin')) {
      return DetectedIde.Devin;
    }
    if (lowerCaseCommand.includes('replit')) {
      return DetectedIde.Replit;
    }
    if (lowerCaseCommand.includes('cursor')) {
      return DetectedIde.Cursor;
    }
    if (lowerCaseCommand.includes('codespaces')) {
      return DetectedIde.Codespaces;
    }
    if (lowerCaseCommand.includes('cloudshell')) {
      return DetectedIde.CloudShell;
    }
    if (lowerCaseCommand.includes('trae')) {
      return DetectedIde.Trae;
    }
    if (
      lowerCaseCommand.includes('firebasestudio') ||
      lowerCaseCommand.includes('monospace')
    ) {
      return DetectedIde.FirebaseStudio;
    }
    if (lowerCaseCommand.includes('code')) {
      return DetectedIde.VSCode;
    }
  } catch (_error) {
    // Fallback to a generic fork if we can't get the process info
    return DetectedIde.VSCodeFork;
  }

  // If no specific IDE is detected, default to a generic fork.
  return DetectedIde.VSCodeFork;
}
