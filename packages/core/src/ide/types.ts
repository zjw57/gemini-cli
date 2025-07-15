/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ActiveFile {
  path: string;
  content: string;
}

export interface IDEContext {
  activeFile?: ActiveFile;
}
