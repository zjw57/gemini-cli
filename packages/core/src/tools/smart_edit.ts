/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
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
import { Content, Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { Config, ApprovalMode } from '../config/config.js';
import { DEFAULT_DIFF_OPTIONS } from './diffOptions.js';
import { ModifiableTool, ModifyContext } from './modifiable-tool.js';
import { GeminiClient } from '../core/client.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';

const EDIT_SYS_PROMPT = `
You are a precise code editing assistant that performs search and replace operations on code snippets. Your task is to identify the exact text that needs to be changed and provide the replacement text.

You are given the code to be edited and an instruction for what needs to be done. You are to respond with a list of search/replace edits.

# Rules
1. Exact Matching: The search field must contain the EXACT text as it appears in the given code, including whitespace, indentation, and line breaks.
2. Minimal Changes: Make only the changes necessary to fulfill the instruction.
3. Preserve Formatting: Maintain existing code style, indentation, and formatting unless specifically asked to change it.
4. One Edit Per Logical Change: Split complex changes into multiple edit objects if they affect different parts of the file.
5. Context Awareness: Consider the surrounding code context to ensure changes don't break functionality.
6. No Duplicates: If the same text appears multiple times, specify which occurrence(s) to change in the explanation.
7. No overlaps: Ensure the edits do not overlap.
`;

const EDIT_USER_PROMPT = `
# Instruction
{instruction}
# Code
{code}
`;

/**
 * Parameters for the SmartEdit tool
 */
export interface SmartEditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

  /**
   * The instruction for what needs to be done.
   */
  instruction: string;

  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;
}

interface SearchReplaceEdit {
  search: string;
  replace: string;
  explanation: string;
}

interface MultiSearchReplaceEdit {
  edits: SearchReplaceEdit[];
}

const SearchReplaceEditSchema = {
  type: Type.OBJECT,
  properties: {
    search: { type: Type.STRING },
    replace: { type: Type.STRING },
    explanation: { type: Type.STRING },
  },
  required: ['search', 'replace', 'explanation'],
};

const MultiSearchReplaceEditSchema = {
  type: Type.OBJECT,
  properties: {
    edits: {
      type: Type.ARRAY,
      items: SearchReplaceEditSchema,
    },
  },
  required: ['edits'],
};

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
}

/**
 * Implementation of the SmartEdit tool logic
 */
export class SmartEditTool
  extends BaseTool<SmartEditToolParams, ToolResult>

  implements ModifiableTool<SmartEditToolParams>
{
  static readonly Name = 'smart_edit';
  private editCache: CalculatedEdit | null = null;

  constructor(private readonly config: Config) {
    super(
      SmartEditTool.Name,
      'Smart Edit',
      `Performs a series of search and replace edits to a file based on an instruction.`,
      Icon.Pencil,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: Type.STRING,
          },
          instruction: {
            description: 'The instruction for what needs to be done.',
            type: Type.STRING,
          },
        },
        required: ['file_path', 'instruction'],
        type: Type.OBJECT,
      },
    );
  }

  /**
   * Validates the parameters for the SmartEdit tool
   * @param params Parameters to validate
   * @returns Error message string or null if valid
   */
  validateToolParams(params: SmartEditToolParams): string | null {
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
      return `File path must be within one of the workspace directories: ${directories.join(
        ', ',
      )}`;
    }

    return null;
  }

  /**
   * Determines any file locations affected by the tool execution
   * @param params Parameters for the tool execution
   * @returns A list of such paths
   */
  toolLocations(params: SmartEditToolParams): ToolLocation[] {
    return [{ path: params.file_path }];
  }

  private async _getEdits(
    code: string,
    instruction: string,
    geminiClient: GeminiClient,
    abortSignal: AbortSignal,
  ): Promise<MultiSearchReplaceEdit> {
    const userPrompt = EDIT_USER_PROMPT.replace(
      '{instruction}',
      instruction,
    ).replace('{code}', code);

    const contents: Content[] = [
      { role: 'user', parts: [{ text: `${EDIT_SYS_PROMPT}\n${userPrompt}` }] },
    ];

    const result = (await geminiClient.generateJson(
      contents,
      MultiSearchReplaceEditSchema,
      abortSignal,
      DEFAULT_GEMINI_FLASH_MODEL,
    )) as unknown as MultiSearchReplaceEdit;

    return result;
  }

  private _applyEdits(
    code: string,
    edits: SearchReplaceEdit[],
  ): {
    newContent: string;
    error?: { display: string; raw: string; type: ToolErrorType };
  } {
    const appliedEdits: { start: number; end: number; replace: string }[] = [];
    for (const edit of edits) {
      const start = code.indexOf(edit.search);

      if (start === -1) {
        const error = {
          display: `Could not find code for search string: '${edit.search}'`,
          raw: `Could not find code for search string: '${edit.search}'`,
          type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
        };
        return { newContent: code, error };
      }

      const end = start + edit.search.length;
      appliedEdits.push({ start, end, replace: edit.replace });
    }

    appliedEdits.sort((a, b) => a.start - b.start);

    for (let i = 0; i < appliedEdits.length - 1; i++) {
      const currentEdit = appliedEdits[i];
      const nextEdit = appliedEdits[i + 1];
      if (currentEdit.end > nextEdit.start) {
        const error = {
          display: 'Generated edits have overlaps and cannot be applied.',
          raw: `Generated edits have overlaps and cannot be applied. Edit 1 ends at ${currentEdit.end}. Edit 2 starts at ${nextEdit.start}.`,
          type: ToolErrorType.EDIT_APPLICATION_FAILURE,
        };
        return { newContent: code, error };
      }
    }

    appliedEdits.sort((a, b) => b.start - a.start);

    let editedCode = code;
    for (const edit of appliedEdits) {
      editedCode =
        editedCode.substring(0, edit.start) +
        edit.replace +
        editedCode.substring(edit.end);
    }

    return { newContent: editedCode };
  }

  /**
   * Calculates the potential outcome of an edit operation.
   * @param params Parameters for the edit operation
   * @returns An object describing the potential edit outcome
   * @throws File system errors if reading the file fails unexpectedly (e.g., permissions)
   */
  private async calculateEdit(
    params: SmartEditToolParams,
    abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    let currentContent: string | null = null;
    let isNewFile = false;

    try {
      currentContent = fs.readFileSync(params.file_path, 'utf8');
      currentContent = currentContent.replace(/\r\n/g, '\n');
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
    }

    if (currentContent === null) {
      return {
        currentContent,
        newContent: '',
        error: {
          display: `File not found. Cannot apply edit.`,
          raw: `File not found: ${params.file_path}`,
          type: ToolErrorType.FILE_NOT_FOUND,
        },
        isNewFile,
      };
    }

    const geminiClient = this.config.getGeminiClient();
    const edits = await this._getEdits(
      currentContent,
      params.instruction,
      geminiClient,
      abortSignal,
    );

    if (!edits || !edits.edits || edits.edits.length === 0) {
      return {
        currentContent,
        newContent: currentContent,
        error: {
          display: 'No edits were generated by the model.',
          raw: 'No edits were generated by the model.',
          type: ToolErrorType.EDIT_NO_CHANGE,
        },
        isNewFile,
      };
    }

    const { newContent, error } = this._applyEdits(currentContent, edits.edits);

    return {
      currentContent,
      newContent,
      error,
      isNewFile,
    };
  }

  /**
   * Handles the confirmation prompt for the Edit tool in the CLI.
   * It needs to calculate the diff to show the user.
   */
  async shouldConfirmExecute(
    params: SmartEditToolParams,
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    const validationError = this.validateToolParams(params);
    if (validationError) {
      console.error(
        `[SmartEditTool] Attempted confirmation with invalid parameters: ${validationError}`,
      );
      return false;
    }

    let editData: CalculatedEdit;
    try {
      this.editCache = null; // Clear previous cache
      editData = await this.calculateEdit(params, abortSignal);
      this.editCache = editData;
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
      title: `Confirm Edit: ${shortenPath(
        makeRelative(params.file_path, this.config.getTargetDir()),
      )}`,
      fileName,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        } else if (outcome === ToolConfirmationOutcome.Cancel) {
          this.editCache = null;
        }
      },
    };
    return confirmationDetails;
  }

  getDescription(params: SmartEditToolParams): string {
    if (!params.file_path || !params.instruction) {
      return `Model did not provide valid parameters for smart_edit tool`;
    }
    const relativePath = makeRelative(
      params.file_path,
      this.config.getTargetDir(),
    );
    return `Apply instruction "${params.instruction}" to ${shortenPath(
      relativePath,
    )}`;
  }

  /**
   * Executes the edit operation with the given parameters.
   * @param params Parameters for the edit operation
   * @returns Result of the edit operation
   */
  async execute(
    params: SmartEditToolParams,
    signal: AbortSignal,
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
    if (this.editCache) {
      editData = this.editCache;
      this.editCache = null; // Clear the cache after use
    } else {
      try {
        editData = await this.calculateEdit(params, signal);
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
      fs.writeFileSync(params.file_path, editData.newContent, 'utf8');

      const fileName = path.basename(params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        editData.currentContent ?? '',
        editData.newContent,
        'Current',
        'Proposed',
        DEFAULT_DIFF_OPTIONS,
      );
      const displayResult: ToolResultDisplay = {

        fileDiff,
        fileName,
        originalContent: editData.currentContent,
        newContent: editData.newContent,
      };

      const llmSuccessMessageParts = [
        `Successfully modified file: ${params.file_path}.`,
      ];
      if (params.modified_by_user) {
        llmSuccessMessageParts.push(
          `User modified the instruction to be: ${params.instruction}.`,
        );
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

  /**
   * Creates parent directories if they don't exist
   */
  private ensureParentDirectoriesExist(filePath: string): void {
    const dirName = path.dirname(filePath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
  }

  getModifyContext(_: AbortSignal): ModifyContext<SmartEditToolParams> {
    return {
      getFilePath: (params: SmartEditToolParams) => params.file_path,
      getCurrentContent: async (
        params: SmartEditToolParams,
      ): Promise<string> => {
        try {
          return fs.readFileSync(params.file_path, 'utf8');
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (
        params: SmartEditToolParams,
      ): Promise<string> => {
        const editData = await this.calculateEdit(
          params,
          new AbortController().signal,
        );
        return editData.newContent;
      },
      createUpdatedParams: (
        _oldContent: string,
        modifiedProposedContent: string,
        originalParams: SmartEditToolParams,
      ): SmartEditToolParams => ({
        ...originalParams,
        // This is tricky because we can't just set the instruction.
        // For now, we'll just mark it as modified.
        instruction: `User provided content directly:\n${modifiedProposedContent}`,
        modified_by_user: true,
      }),
    };
  }
}
