/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  disableExtension,
  enableExtension,
  loadUserExtensions,
  refreshExtensions,
  toOutputString,
} from '../../config/extension.js';
import { SettingScope } from '../../config/settings.js';
import {
  type CommandContext,
  CommandKind,
  type SlashCommand,
  type SlashCommandActionReturn,
} from './types.js';

const listCommand: SlashCommand = {
  name: 'list',
  description: 'Lists installed extensions.',
  kind: CommandKind.BUILT_IN,
  action: async (): Promise<SlashCommandActionReturn> => {
    const extensions = loadUserExtensions();
    if (extensions.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No extensions installed.',
      };
    }

    return {
      type: 'message',
      messageType: 'info',
      content: extensions
        .map((extension) => toOutputString(extension))
        .join('  \n\n'),
    };
  },
};

const enableCommand: SlashCommand = {
  name: 'enable',
  description: 'Enables an extension.',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const [name] = args.split(' ');
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /extensions enable <name>',
      };
    }

    enableExtension(name, [SettingScope.User, SettingScope.Workspace]);

    return {
      type: 'message',
      messageType: 'info',
      content: `Extension "${name}" successfully enabled.`, 
    };
  },
};

const disableCommand: SlashCommand = {
  name: 'disable',
  description: 'Disables an extension.',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const [name] = args.split(' ');
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /extensions disable <name>',
      };
    }

    disableExtension(name, SettingScope.User);

    return {
      type: 'message',
      messageType: 'info',
      content: `Extension "${name}" successfully disabled.`, 
    };
  },
};

const refreshCommand: SlashCommand = {
  name: 'refresh',
  description: 'Refreshes all extensions.',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    refreshExtensions(process.cwd());
    context.ui.reloadCommands();
    return {
      type: 'message',
      messageType: 'info',
      content: 'Extensions refreshed.',
    };
  },
};

export const extensionsCommand: SlashCommand = {
  name: 'extensions',
  description: 'Manages extensions.',
  kind: CommandKind.BUILT_IN,
  subCommands: [listCommand, enableCommand, disableCommand, refreshCommand],
  action: async (context: CommandContext, args: string) =>
    listCommand.action!(context, args),
};
