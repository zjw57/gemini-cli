/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandModule } from 'yargs';
import { updateExtension } from '../../config/extension.js';

interface UpdateArgs {
  name: string;
}

export async function handleUpdate(args: UpdateArgs) {
  try {
    await updateExtension(args.name);
    console.log(`Extension "${args.name}" successfully updated.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

export const updateCommand: CommandModule = {
  command: 'update [name]',
  describe: 'Updates an extension.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension to update.',
        type: 'string',
      })
      .check((_argv) => true),
  handler: async (argv) => {
    await handleUpdate({
      name: argv['name'] as string,
    });
  },
};
