/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum DetectedIde {
  Devin = 'devin',
  Replit = 'replit',
  Cursor = 'cursor',
  CloudShell = 'cloudshell',
  Codespaces = 'codespaces',
  FirebaseStudio = 'firebasestudio',
  Trae = 'trae',
  VSCode = 'vscode',
  VSCodeFork = 'vscodefork',
}

export interface CustomIde {
  name: string;
  displayName: string;
}

export type DetectedIdeInfo = DetectedIde | CustomIde;

export function getIdeInfo(ide: DetectedIdeInfo): CustomIde {
  if (typeof ide === 'string') {
    switch (ide) {
      case DetectedIde.Devin:
        return {
          name: DetectedIde.Devin,
          displayName: 'Devin',
        };
      case DetectedIde.Replit:
        return {
          name: DetectedIde.Replit,
          displayName: 'Replit',
        };
      case DetectedIde.Cursor:
        return {
          name: DetectedIde.Cursor,
          displayName: 'Cursor',
        };
      case DetectedIde.CloudShell:
        return {
          name: DetectedIde.CloudShell,
          displayName: 'Cloud Shell',
        };
      case DetectedIde.Codespaces:
        return {
          name: DetectedIde.Codespaces,
          displayName: 'GitHub Codespaces',
        };
      case DetectedIde.FirebaseStudio:
        return {
          name: DetectedIde.FirebaseStudio,
          displayName: 'Firebase Studio',
        };
      case DetectedIde.Trae:
        return {
          name: DetectedIde.Trae,
          displayName: 'Trae',
        };
      case DetectedIde.VSCode:
        return {
          name: DetectedIde.VSCode,
          displayName: 'VS Code',
        };
      case DetectedIde.VSCodeFork:
        return {
          name: DetectedIde.VSCodeFork,
          displayName: 'IDE',
        };
      default: {
        // This ensures that if a new IDE is added to the enum, we get a compile-time error.
        const exhaustiveCheck: never = ide;
        return exhaustiveCheck;
      }
    }
  }
  return ide;
}

export function detectIdeFromEnv(): DetectedIde {
  if (process.env['__COG_BASHRC_SOURCED']) {
    return DetectedIde.Devin;
  }
  if (process.env['REPLIT_USER']) {
    return DetectedIde.Replit;
  }
  if (process.env['CURSOR_TRACE_ID']) {
    return DetectedIde.Cursor;
  }
  if (process.env['CODESPACES']) {
    return DetectedIde.Codespaces;
  }
  if (process.env['EDITOR_IN_CLOUD_SHELL'] || process.env['CLOUD_SHELL']) {
    return DetectedIde.CloudShell;
  }
  if (process.env['TERM_PRODUCT'] === 'Trae') {
    return DetectedIde.Trae;
  }
  if (process.env['MONOSPACE_ENV']) {
    return DetectedIde.FirebaseStudio;
  }
  return DetectedIde.VSCode;
}

function verifyVSCode(
  ide: DetectedIde,
  ideProcessInfo: {
    pid: number;
    command: string;
  },
): DetectedIde {
  if (ide !== DetectedIde.VSCode) {
    return ide;
  }
  if (ideProcessInfo.command.toLowerCase().includes('code')) {
    return DetectedIde.VSCode;
  }
  return DetectedIde.VSCodeFork;
}

export function detectIdeInternal(ideProcessInfo: {
  pid: number;
  command: string;
}): DetectedIde | undefined {
  // Only VSCode-based integrations are currently supported.
  if (process.env['TERM_PROGRAM'] !== 'vscode') {
    return undefined;
  }

  const ide = detectIdeFromEnv();
  return verifyVSCode(ide, ideProcessInfo);
}

export function detectIde(
  ideProcessInfo: {
    pid: number;
    command: string;
  },
  connectionConfig?: { ide?: CustomIde },
): DetectedIdeInfo | undefined {
  if (connectionConfig?.ide) {
    return connectionConfig.ide;
  }
  return detectIdeInternal(ideProcessInfo);
}
