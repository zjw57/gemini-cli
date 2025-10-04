/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { makeRelative, shortenPath } from '../utils/paths.js';
import type { ToolInvocation, ToolLocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';

import type { PartUnion } from '@google/genai';
import {
  processSingleFileContent,
  getSpecificMimeType,
} from '../utils/fileUtils.js';
import type { Config } from '../config/config.js';
import { FileOperation } from '../telemetry/metrics.js';
import { getProgrammingLanguage } from '../telemetry/telemetry-utils.js';
import { logFileOperation } from '../telemetry/loggers.js';
import { FileOperationEvent } from '../telemetry/types.js';
import { resolveToolPath } from '../utils/pathResolution.js';
import { ToolErrorType } from './tool-error.js';

/**
 * Parameters for the ReadFile tool
 */
export interface ReadFileToolParams {
  /**
   * The path to the file to read.
   */
  path: string;

  /**
   * The line number to start reading from (optional)
   */
  offset?: number;

  /**
   * The number of lines to read (optional)
   */
  limit?: number;
}

class ReadFileToolInvocation extends BaseToolInvocation<
  ReadFileToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: ReadFileToolParams,
  ) {
    super(params);
  }

  // Note: getDescription and toolLocations will use the raw, potentially
  // relative/ambiguous path from params. This is a limitation of the
  // prototype approach (Option B).
  getDescription(): string {
    // Best effort relative path for display
    try {
      const relativePath = makeRelative(
        this.params.path,
        this.config.getTargetDir(),
      );
      return shortenPath(relativePath);
    } catch {
      return this.params.path;
    }
  }

  override toolLocations(): ToolLocation[] {
    // We don't know the resolved path yet, so we can't provide a location.
    return [];
  }

  async execute(): Promise<ToolResult> {
    // 1. Resolve the path asynchronously
    const resolution = await resolveToolPath({
      inputPath: this.params.path,
      config: this.config,
      expectedType: 'file',
      allowNonExistent: false,
    });

    if (!resolution.success) {
      return {
        llmContent: resolution.error,
        returnDisplay: `Error: ${resolution.error}`,
        error: {
          message: resolution.error,
          type: resolution.errorType,
        },
      };
    }

    const resolvedPath = resolution.absolutePath;

    // Check .geminiignore (moved from validateToolParamValues)
    const fileService = this.config.getFileService();
    if (fileService.shouldGeminiIgnoreFile(resolvedPath)) {
      const errorMsg = `File path '${makeRelative(resolvedPath, this.config.getTargetDir())}' is ignored by .geminiignore pattern(s).`;
      return {
        llmContent: errorMsg,
        returnDisplay: 'Error: File is ignored.',
        error: {
          message: errorMsg,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // 2. Proceed with reading the resolved path
    const result = await processSingleFileContent(
      resolvedPath,
      this.config.getTargetDir(),
      this.config.getFileSystemService(),
      this.params.offset,
      this.params.limit,
    );

    if (result.error) {
      return {
        llmContent: result.llmContent,
        returnDisplay: result.returnDisplay || 'Error reading file',
        error: {
          message: result.error,
          type: result.errorType,
        },
      };
    }

    let llmContent: PartUnion;
    if (result.isTruncated) {
      const [start, end] = result.linesShown!;
      const total = result.originalLineCount!;
      const nextOffset = this.params.offset
        ? this.params.offset + end - start + 1
        : end;
      llmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines ${start}-${end} of ${total} total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: ${nextOffset}.

--- FILE CONTENT (truncated) ---
${result.llmContent}`;
    } else {
      llmContent = result.llmContent || '';
    }

    const lines =
      typeof result.llmContent === 'string'
        ? result.llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(resolvedPath);
    const programming_language = getProgrammingLanguage({
      absolute_path: resolvedPath,
    });
    logFileOperation(
      this.config,
      new FileOperationEvent(
        ReadFileTool.Name,
        FileOperation.READ,
        lines,
        mimetype,
        path.extname(resolvedPath),
        programming_language,
      ),
    );

    return {
      llmContent,
      returnDisplay: result.returnDisplay || '',
    };
  }
}

/**
 * Implementation of the ReadFile tool logic
 */
export class ReadFileTool extends BaseDeclarativeTool<
  ReadFileToolParams,
  ToolResult
> {
  static readonly Name: string = 'read_file';

  constructor(private config: Config) {
    super(
      ReadFileTool.Name,
      'ReadFile',
      `Reads and returns the content of a file. Supports text, images (PNG, JPG, GIF, WEBP, SVG, BMP), and PDFs.

Features:
1. **Smart Path Resolution:** Accepts absolute paths, paths relative to the workspace, or simple filenames (if unique in the workspace).
2. **Large Files:** Automatically truncates large files. The response guides you on using 'offset' and 'limit' to paginate.
3. **Parallelism:** To read multiple files efficiently, issue multiple separate calls to this tool in a single turn. Do not read files sequentially if you know the paths ahead of time.`,
      Kind.Read,
      {
        properties: {
          path: {
            description:
              "The path to the file to read. Can be absolute (e.g., '/home/user/file.txt'), relative (e.g., 'src/file.txt'), or a unique filename (e.g., 'unique_file.ts').",
            type: 'string',
          },
          offset: {
            description:
              "Optional: For text files, the 0-based line number to start reading from. Requires 'limit' to be set. Use for paginating through large files.",
            type: 'number',
          },
          limit: {
            description:
              "Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. If omitted, reads the entire file (if feasible, up to a default limit).",
            type: 'number',
          },
        },
        required: ['path'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: ReadFileToolParams,
  ): string | null {
    // Only basic type/empty checks here. Path validation is now in execute().
    if (params.path.trim() === '') {
      return "The 'path' parameter must be non-empty.";
    }
    if (params.offset !== undefined && params.offset < 0) {
      return 'Offset must be a non-negative number';
    }
    if (params.limit !== undefined && params.limit <= 0) {
      return 'Limit must be a positive number';
    }
    return null;
  }

  protected createInvocation(
    params: ReadFileToolParams,
  ): ToolInvocation<ReadFileToolParams, ToolResult> {
    return new ReadFileToolInvocation(this.config, params);
  }
}
