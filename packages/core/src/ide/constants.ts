/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'node:os';
import * as path from 'node:path';

export const GEMINI_CLI_COMPANION_EXTENSION_NAME = 'Gemini CLI Companion';
export const IDE_MAX_OPEN_FILES = 10;
export const IDE_MAX_SELECTED_TEXT_LENGTH = 16384; // 16 KiB limit
export const IDE_PORT_FILE_DIR = path.join(os.tmpdir(), '.gemini', 'ide');
