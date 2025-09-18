/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const IDE_DEFINITIONS = {
  devin: { name: 'devin', displayName: 'Devin' },
  replit: { name: 'replit', displayName: 'Replit' },
  cursor: { name: 'cursor', displayName: 'Cursor' },
  cloudshell: { name: 'cloudshell', displayName: 'Cloud Shell' },
  codespaces: { name: 'codespaces', displayName: 'GitHub Codespaces' },
  firebasestudio: { name: 'firebasestudio', displayName: 'Firebase Studio' },
  trae: { name: 'trae', displayName: 'Trae' },
  vscode: { name: 'vscode', displayName: 'VS Code' },
  vscodefork: { name: 'vscodefork', displayName: 'IDE' },
} as const;

export const DetectedIde = Object.fromEntries(
  Object.values(IDE_DEFINITIONS).map((ide) => [ide.displayName, ide]),
) as unknown as {
  [K in keyof typeof IDE_DEFINITIONS as Capitalize<K>]: (typeof IDE_DEFINITIONS)[K];
};

export type DetectedIdeName = keyof typeof IDE_DEFINITIONS;

export interface IdeInfo {
  name: string;
  displayName: string;
}

export function getIdeInfo(ide: IdeInfo): IdeInfo {
  return ide;
}

export function detectIdeFromEnv(): IdeInfo {
  if (process.env['__COG_BASHRC_SOURCED']) {
    return IDE_DEFINITIONS.devin;
  }
  if (process.env['REPLIT_USER']) {
    return IDE_DEFINITIONS.replit;
  }
  if (process.env['CURSOR_TRACE_ID']) {
    return IDE_DEFINITIONS.cursor;
  }
  if (process.env['CODESPACES']) {
    return IDE_DEFINITIONS.codespaces;
  }
  if (process.env['EDITOR_IN_CLOUD_SHELL'] || process.env['CLOUD_SHELL']) {
    return IDE_DEFINITIONS.cloudshell;
  }
  if (process.env['TERM_PRODUCT'] === 'Trae') {
    return IDE_DEFINITIONS.trae;
  }
  if (process.env['MONOSPACE_ENV']) {
    return IDE_DEFINITIONS.firebasestudio;
  }
  return IDE_DEFINITIONS.vscode;
}

function verifyVSCode(
  ide: IdeInfo,
  ideProcessInfo: {
    pid: number;
    command: string;
  },
): IdeInfo {
  if (ide.name !== 'vscode') {
    return ide;
  }
  if (ideProcessInfo.command.toLowerCase().includes('code')) {
    return IDE_DEFINITIONS.vscode;
  }
  return IDE_DEFINITIONS.vscodefork;
}

export function detectIdeInternal(ideProcessInfo: {
  pid: number;
  command: string;
}): IdeInfo | undefined {
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
  connectionConfig?: {ide?: IdeInfo},
): IdeInfo | undefined {
  if (connectionConfig?.ide) {
    return connectionConfig.ide;
  }
  return detectIdeInternal(ideProcessInfo);
}
