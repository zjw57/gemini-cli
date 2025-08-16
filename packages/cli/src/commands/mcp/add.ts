/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'gemini mcp add' command
import type { CommandModule } from 'yargs';
import { MCPServerConfig } from '@google/gemini-cli-core';
import { SettingsManager } from '../../config/settings-manager.js';
import { scopeOption } from '../shared-options.js';
import { getScope } from '../../utils/scope.js';
import { handlerWrapper } from '../handler-wrapper.js';

async function addMcpServer(argv: {
  name: string;
  commandOrUrl: string;
  args?: Array<string | number>;
  scope?: string;
  transport?: string;
  env?: string[];
  header?: string[];
  timeout?: number;
  trust?: boolean;
  description?: string;
  includeTools?: string[];
  excludeTools?: string[];
}) {
  const {
    name,
    commandOrUrl,
    args,
    scope,
    transport,
    env,
    header,
    timeout,
    trust,
    description,
    includeTools,
    excludeTools,
  } = argv;
  const settingsManager = new SettingsManager(getScope(argv));

  let newServer: Partial<MCPServerConfig> = {};

  const headers = header?.reduce(
    (acc, curr) => {
      const [key, ...valueParts] = curr.split(':');
      const value = valueParts.join(':').trim();
      if (key.trim() && value) {
        acc[key.trim()] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  switch (transport) {
    case 'sse':
      newServer = {
        url: commandOrUrl,
        headers,
        timeout,
        trust,
        description,
        includeTools,
        excludeTools,
      };
      break;
    case 'http':
      newServer = {
        httpUrl: commandOrUrl,
        headers,
        timeout,
        trust,
        description,
        includeTools,
        excludeTools,
      };
      break;
    case 'stdio':
    default:
      newServer = {
        command: commandOrUrl,
        args: args?.map(String),
        env: env?.reduce(
          (acc, curr) => {
            const [key, value] = curr.split('=');
            if (key && value) {
              acc[key] = value;
            }
            return acc;
          },
          {} as Record<string, string>,
        ),
        timeout,
        trust,
        description,
        includeTools,
        excludeTools,
      };
      break;
  }

  const mcpServers = await settingsManager.getMcpServers();

  const isExistingServer = !!mcpServers[name];
  if (isExistingServer) {
    console.log(
      `MCP server "${name}" is already configured within ${scope} settings.`,
    );
  }

  await settingsManager.addMcpServer(name, newServer as MCPServerConfig);

  if (isExistingServer) {
    console.log(`MCP server "${name}" updated in ${scope} settings.`);
  } else {
    console.log(
      `MCP server "${name}" added to ${scope} settings. (${transport})`,
    );
  }
}

export const addCommand: CommandModule = {
  command: 'add <name> <commandOrUrl> [args...]',
  describe: 'Add a server',
  builder: (yargs) =>
    yargs
      .usage('Usage: gemini mcp add [options] <name> <commandOrUrl> [args...]')
      .parserConfiguration({
        'unknown-options-as-args': true, // Pass unknown options as server args
        'populate--': true, // Populate server args after -- separator
      })
      .positional('name', {
        describe: 'Name of the server',
        type: 'string',
        demandOption: true,
      })
      .positional('commandOrUrl', {
        describe: 'Command (stdio) or URL (sse, http)',
        type: 'string',
        demandOption: true,
      })
      .option('scope', scopeOption)
      .option('transport', {
        alias: 't',
        describe: 'Transport type (stdio, sse, http)',
        type: 'string',
        default: 'stdio',
        choices: ['stdio', 'sse', 'http'],
      })
      .option('env', {
        alias: 'e',
        describe: 'Set environment variables (e.g. -e KEY=value)',
        type: 'array',
        string: true,
      })
      .option('header', {
        alias: 'H',
        describe:
          'Set HTTP headers for SSE and HTTP transports (e.g. -H "X-Api-Key: abc123" -H "Authorization: Bearer abc123")',
        type: 'array',
        string: true,
      })
      .option('timeout', {
        describe: 'Set connection timeout in milliseconds',
        type: 'number',
      })
      .option('trust', {
        describe:
          'Trust the server (bypass all tool call confirmation prompts)',
        type: 'boolean',
      })
      .option('description', {
        describe: 'Set the description for the server',
        type: 'string',
      })
      .option('include-tools', {
        describe: 'A comma-separated list of tools to include',
        type: 'array',
        string: true,
      })
      .option('exclude-tools', {
        describe: 'A comma-separated list of tools to exclude',
        type: 'array',
        string: true,
      })
      .middleware((argv) => {
        // Handle -- separator args as server args if present
        if (argv['--']) {
          const existingArgs = (argv.args as Array<string | number>) || [];
          argv.args = [...existingArgs, ...(argv['--'] as string[])];
        }
      }),
  handler: handlerWrapper(
    addMcpServer,
    'An error occurred while adding the MCP server',
  ),
};
