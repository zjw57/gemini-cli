/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini mcp remove' command
import type { CommandModule } from 'yargs';
import { SettingsManager } from '../../config/settings-manager.js';
import { scopeOption } from '../shared-options.js';
import { getScope } from '../../utils/scope.js';
import { handlerWrapper } from '../handler-wrapper.js';

async function removeMcpServer(argv: { name: string; scope?: string }) {
  const { name, scope } = argv;
  const settingsManager = new SettingsManager(getScope(argv));

  const mcpServers = await settingsManager.getMcpServers();

  if (!mcpServers[name]) {
    console.log(`Server "${name}" not found in ${scope} settings.`);
    return;
  }

  await settingsManager.removeMcpServer(name);

  console.log(`Server "${name}" removed from ${scope} settings.`);
}

export const removeCommand: CommandModule = {
  command: 'remove <name>',
  describe: 'Remove a server',
  builder: (yargs) =>
    yargs
      .usage('Usage: gemini mcp remove [options] <name>')
      .positional('name', {
        describe: 'Name of the server',
        type: 'string',
        demandOption: true,
      })
      .option('scope', scopeOption),
  handler: handlerWrapper(
    removeMcpServer,
    'An error occurred while removing the MCP server',
  ),
};
