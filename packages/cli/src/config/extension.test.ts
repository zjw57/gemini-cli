/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EXTENSIONS_CONFIG_FILENAME,
  EXTENSIONS_DIRECTORY_NAME,
  annotateActiveExtensions,
  loadExtensions,
} from './extension.js';

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>();
  return {
    ...os,
    homedir: vi.fn(),
  };
});

describe('loadExtensions', () => {
  let tempWorkspaceDir: string;
  let tempHomeDir: string;

  beforeEach(() => {
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-workspace-'),
    );
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
  });

  afterEach(() => {
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it('should include extension path in loaded extension', () => {
    const workspaceExtensionsDir = path.join(
      tempWorkspaceDir,
      EXTENSIONS_DIRECTORY_NAME,
    );
    fs.mkdirSync(workspaceExtensionsDir, { recursive: true });

    const extensionDir = path.join(workspaceExtensionsDir, 'test-extension');
    fs.mkdirSync(extensionDir, { recursive: true });

    const config = {
      name: 'test-extension',
      version: '1.0.0',
    };
    fs.writeFileSync(
      path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify(config),
    );

    const extensions = loadExtensions(tempWorkspaceDir);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].path).toBe(extensionDir);
    expect(extensions[0].config.name).toBe('test-extension');
  });

  it('should load context file path when GEMINI.md is present', () => {
    const workspaceExtensionsDir = path.join(
      tempWorkspaceDir,
      EXTENSIONS_DIRECTORY_NAME,
    );
    fs.mkdirSync(workspaceExtensionsDir, { recursive: true });
    createExtension(workspaceExtensionsDir, 'ext1', '1.0.0', true);
    createExtension(workspaceExtensionsDir, 'ext2', '2.0.0');

    const extensions = loadExtensions(tempWorkspaceDir);

    expect(extensions).toHaveLength(2);
    const ext1 = extensions.find((e) => e.config.name === 'ext1');
    const ext2 = extensions.find((e) => e.config.name === 'ext2');
    expect(ext1?.contextFiles).toEqual([
      path.join(workspaceExtensionsDir, 'ext1', 'GEMINI.md'),
    ]);
    expect(ext2?.contextFiles).toEqual([]);
  });

  it('should load context file path from the extension config', () => {
    const workspaceExtensionsDir = path.join(
      tempWorkspaceDir,
      EXTENSIONS_DIRECTORY_NAME,
    );
    fs.mkdirSync(workspaceExtensionsDir, { recursive: true });
    createExtension(
      workspaceExtensionsDir,
      'ext1',
      '1.0.0',
      false,
      'my-context-file.md',
    );

    const extensions = loadExtensions(tempWorkspaceDir);

    expect(extensions).toHaveLength(1);
    const ext1 = extensions.find((e) => e.config.name === 'ext1');
    expect(ext1?.contextFiles).toEqual([
      path.join(workspaceExtensionsDir, 'ext1', 'my-context-file.md'),
    ]);
  });
});

describe('annotateActiveExtensions', () => {
  const extensions = [
    { path: '', config: { name: 'ext1', version: '1.0.0' }, contextFiles: [] },
    { path: '', config: { name: 'ext2', version: '1.0.0' }, contextFiles: [] },
    { path: '', config: { name: 'ext3', version: '1.0.0' }, contextFiles: [] },
  ];

  const managedExtensions = [
    {
      name: 'ext1',
      source: '',
      installDate: '',
      lastUpdated: '',
      active: true,
      scope: 'user' as const,
    },
    {
      name: 'ext2',
      source: '',
      installDate: '',
      lastUpdated: '',
      active: false,
      scope: 'user' as const,
    },
  ];

  it('should correctly annotate extensions based on managed status', () => {
    const annotated = annotateActiveExtensions(extensions, managedExtensions);
    expect(annotated).toHaveLength(3);
    expect(annotated.find((e) => e.name === 'ext1')?.isActive).toBe(true);
    expect(annotated.find((e) => e.name === 'ext2')?.isActive).toBe(false);
    expect(annotated.find((e) => e.name === 'ext3')?.isActive).toBe(true);
  });
});

function createExtension(
  extensionsDir: string,
  name: string,
  version: string,
  addContextFile = false,
  contextFileName?: string,
): void {
  const extDir = path.join(extensionsDir, name);
  fs.mkdirSync(extDir);
  fs.writeFileSync(
    path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
    JSON.stringify({ name, version, contextFileName }),
  );

  if (addContextFile) {
    fs.writeFileSync(path.join(extDir, 'GEMINI.md'), 'context');
  }

  if (contextFileName) {
    fs.writeFileSync(path.join(extDir, contextFileName), 'context');
  }
}
