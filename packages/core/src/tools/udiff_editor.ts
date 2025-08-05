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

export interface UdiffEditorParams {
  file_path: string;
  udiff_content: string;
  modified_by_user?: boolean;
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
}

export class UdiffEditor extends BaseTool<UdiffEditorParams, ToolResult> {
  static readonly Name = 'udiff_editor';

  constructor(private readonly config: Config) {
    super(
      UdiffEditor.Name,
      'Udiff Editor',
      'Applies a unified diff to a file. The "udiff" edit format is based on the widely used unified diff format.',
      Icon.Pencil,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: Type.STRING,
          },
          udiff_content: {
            description: 'The unified diff content to apply to the file.',
            type: Type.STRING,
          },
        },
        required: ['file_path', 'udiff_content'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: UdiffEditorParams): string | null {
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

  toolLocations(params: UdiffEditorParams): ToolLocation[] {
    return [{ path: params.file_path }];
  }

  private async calculateEdit(
    params: UdiffEditorParams,
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
        currentContent = ''; // Treat non-existent file as empty
      } else {
        throw err;
      }
    }

    if (!fileExists) {
      isNewFile = true;
    }

    const newContent = Diff.applyPatch(currentContent, params.udiff_content);

    if (newContent === false) {
      return {
        currentContent,
        newContent: '',
        error: {
          display: `The provided udiff could not be applied to the file.`,
          raw: `The provided udiff could not be applied to the file: ${params.file_path}`,
          type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
        },
        isNewFile,
      };
    }

    return {
      currentContent,
      newContent,
      isNewFile,
    };
  }

  async shouldConfirmExecute(
    params: UdiffEditorParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    const validationError = this.validateToolParams(params);
    if (validationError) {
      console.error(
        `[UdiffEditor] Attempted confirmation with invalid parameters: ${validationError}`,
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

  getDescription(params: UdiffEditorParams): string {
    const relativePath = makeRelative(
      params.file_path,
      this.config.getTargetDir(),
    );
    return `Apply udiff to ${shortenPath(relativePath)}`;
  }

  async execute(
    params: UdiffEditorParams,
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
          : `Successfully modified file: ${params.file_path} by applying the udiff.`,
      ];
      if (params.modified_by_user) {
        llmSuccessMessageParts.push(`User modified the udiff.`);
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
