/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs, mkdirSync, existsSync } from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import {
  BaseTool,
  Icon,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolEditConfirmationDetails,
  ToolLocation,
  ToolResult,
  ToolResultDisplay,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { Config, ApprovalMode } from '../config/config.js';
import { DEFAULT_DIFF_OPTIONS } from './diffOptions.js';

// Based on the user-provided interfaces
export interface EditOperation {
  startLine: number;
  linesToDelete: number;
  contentToAdd: string[];
}

export interface RemoveAddLinesEditorParams {
  file_path: string;
  edits: EditOperation[];
  modified_by_user?: boolean;
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
}

export class RemoveAddLinesEditor extends BaseTool<
  RemoveAddLinesEditorParams,
  ToolResult
> {
  static readonly Name = 'RemoveAddLinesEditor';

  constructor(private readonly config: Config) {
    super(
      RemoveAddLinesEditor.Name,
      'Remove/Add Lines Editor',
      'Applies a series of line-based edits to a file.',
      Icon.Pencil,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: Type.STRING,
          },
          edits: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startLine: {
                  type: Type.NUMBER,
                  description:
                    'The 1-based line number where the edit should begin.',
                },
                linesToDelete: {
                  type: Type.NUMBER,
                  description:
                    'The number of lines to delete starting from startLine.',
                },
                contentToAdd: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.STRING,
                  },
                  description:
                    'An array of strings representing the new lines of content to add.',
                },
              },
              required: ['startLine', 'linesToDelete', 'contentToAdd'],
            },
          },
        },
        required: ['file_path', 'edits'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: RemoveAddLinesEditorParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(params.file_path)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    return null;
  }

  toolLocations(params: RemoveAddLinesEditorParams): ToolLocation[] {
    return [{ path: params.file_path }];
  }

  private async calculateEdit(
    params: RemoveAddLinesEditorParams,
  ): Promise<CalculatedEdit> {
    let currentContent: string | null = null;
    let fileExists = false;
    let isNewFile = false;

    try {
      currentContent = await fs.readFile(params.file_path, 'utf8');
      fileExists = true;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        fileExists = false;
      } else {
        throw err;
      }
    }

    if (!fileExists && params.edits.length === 0) {
      isNewFile = true;
      currentContent = '';
    } else if (!fileExists) {
      return {
        currentContent: null,
        newContent: '',
        error: {
          display: `File not found. Cannot apply edit.`,
          raw: `File not found: ${params.file_path}`,
          type: ToolErrorType.FILE_NOT_FOUND,
        },
        isNewFile: false,
      };
    }

    const originalContent = currentContent || '';
    const hadTrailingNewline = originalContent.endsWith('\n');
    const lines = originalContent.replace(/\r\n/g, '\n').split('\n');

    const sortedEdits = [...params.edits].sort(
      (a, b) => b.startLine - a.startLine,
    );

    for (const edit of sortedEdits) {
      const { startLine, linesToDelete, contentToAdd } = edit;
      const isPureInsertion = linesToDelete === 0;
      const maxLine = isPureInsertion ? lines.length + 1 : lines.length;

      if (startLine < 1 || startLine > maxLine) {
        return {
          currentContent,
          newContent: '',
          error: {
            display: `Invalid startLine: ${startLine}. Must be between 1 and ${maxLine} for this operation.`,
            raw: `Invalid startLine: ${startLine}. Must be between 1 and ${maxLine} for this operation.`,
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
          isNewFile,
        };
      }

      lines.splice(startLine - 1, linesToDelete, ...contentToAdd);
    }

    let finalContent = lines.join('\n');

    const hasTrailingNewline = finalContent.endsWith('\n');
    if (hadTrailingNewline && !hasTrailingNewline) {
      finalContent += '\n';
    } else if (
      !hadTrailingNewline &&
      hasTrailingNewline &&
      finalContent.length > 0
    ) {
      if (
        finalContent.length > 1 ||
        (finalContent.length === 1 && finalContent !== '\n')
      ) {
        finalContent = finalContent.slice(0, -1);
      }
    }

    return {
      currentContent,
      newContent: finalContent,
      isNewFile,
    };
  }

  async shouldConfirmExecute(
    params: RemoveAddLinesEditorParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    const validationError = this.validateToolParams(params);
    if (validationError) {
      console.error(
        `[RemoveAddLinesEditor] Attempted confirmation with invalid parameters: ${validationError}`,
      );
      return false;
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(params);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`Error preparing edit: ${errorMsg}`);
      return false;
    }

    if (editData.error) {
      console.log(`Error: ${editData.error.display}`);
      return false;
    }

    const fileName = path.basename(params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      editData.newContent,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS,
    );
    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(params.file_path, this.config.getTargetDir()))}`,
      fileName,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  getDescription(params: RemoveAddLinesEditorParams): string {
    const relativePath = makeRelative(
      params.file_path,
      this.config.getTargetDir(),
    );
    return `Apply ${params.edits.length} edits to ${shortenPath(relativePath)}`;
  }

  async execute(
    params: RemoveAddLinesEditorParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
        error: {
          message: validationError,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(params);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing edit: ${errorMsg}`,
        returnDisplay: `Error preparing edit: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }

    if (editData.error) {
      return {
        llmContent: editData.error.raw,
        returnDisplay: `Error: ${editData.error.display}`,
        error: {
          message: editData.error.raw,
          type: editData.error.type,
        },
      };
    }

    try {
      this.ensureParentDirectoriesExist(params.file_path);
      await fs.writeFile(params.file_path, editData.newContent, 'utf8');

      let displayResult: ToolResultDisplay;
      if (editData.isNewFile) {
        displayResult = `Created ${shortenPath(makeRelative(params.file_path, this.config.getTargetDir()))}`;
      } else {
        const fileName = path.basename(params.file_path);
        const fileDiff = Diff.createPatch(
          fileName,
          editData.currentContent ?? '',
          editData.newContent,
          'Current',
          'Proposed',
          DEFAULT_DIFF_OPTIONS,
        );
        displayResult = {
          fileDiff,
          fileName,
          originalContent: editData.currentContent,
          newContent: editData.newContent,
        };
      }

      const llmSuccessMessageParts = [
        editData.isNewFile
          ? `Created new file: ${params.file_path} with provided content.`
          : `Successfully modified file: ${params.file_path} (${params.edits.length} edits).`,
      ];
      if (params.modified_by_user) {
        llmSuccessMessageParts.push(`User modified the edits.`);
      }

      return {
        llmContent: llmSuccessMessageParts.join(' '),
        returnDisplay: displayResult,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing edit: ${errorMsg}`,
        returnDisplay: `Error writing file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }

  private ensureParentDirectoriesExist(filePath: string): void {
    const dirName = path.dirname(filePath);
    try {
      if (!existsSync(dirName)) {
        mkdirSync(dirName, { recursive: true });
      }
    } catch (_e) {
      // ignore
    }
  }
}
