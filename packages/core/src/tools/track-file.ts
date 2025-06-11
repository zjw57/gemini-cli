/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileContextService } from '../services/fileContextService.js';
import { BaseTool, ToolResult } from './tools.js';

interface TrackFileParams {
  path: string;
}

export class TrackFileTool extends BaseTool<TrackFileParams> {
  static readonly Name = 'track_file';
  constructor(private fileContextService: FileContextService) {
    super(
      'track_file',
      'TrackFile',
      'Adds a file to the ambient context. This is the REQUIRED first step for any multi-turn interaction that involves reading or modifying file contents. The file will be read fresh from disk on every turn, ensuring you always have the most up-to-date version.',
      {
        properties: {
          path: {
            description: 'The path to the file to track',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      },
    );
  }

  async execute(params: TrackFileParams): Promise<ToolResult> {
    this.fileContextService.add(params.path);
    const result = `Now tracking file: ${params.path}`;
    return {
      llmContent: result,
      returnDisplay: result,
    };
  }
}

interface UntrackFileParams {
  path: string;
}

export class UntrackFileTool extends BaseTool<UntrackFileParams> {
  static readonly Name = 'untrack_file';
  constructor(private fileContextService: FileContextService) {
    super(
      'untrack_file',
      'UntrackFile',
      'Removes a file from the ambient context. Removing files from the context stops sending updated versions with every conversation turn',
      {
        properties: {
          path: {
            description: 'The path to the file to untrack',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      },
    );
  }

  async execute(params: UntrackFileParams): Promise<ToolResult> {
    this.fileContextService.remove(params.path);
    const result = `No longer tracking file: ${params.path}`;
    return {
      llmContent: result,
      returnDisplay: result,
    };
  }
}
