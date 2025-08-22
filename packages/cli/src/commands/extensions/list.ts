/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandModule } from 'yargs';
import { loadUserExtensions, toOutputString } from '../../config/extension.js';

export async function handleList() {
  const extensions = loadUserExtensions();
  console.log(
    extensions
      .map((extension, _): string => toOutputString(extension))
      .join('\n\n'),
  );
}

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'Lists installed extensions.',
  builder: (yargs) => yargs,
  handler: async () => {
    await handleList();
  },
};
