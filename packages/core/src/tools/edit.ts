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
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolEditConfirmationDetails,
  ToolResult,
  ToolResultDisplay,
} from './tools.js';
import { findBestFuzzyMatch, FuzzyMatchResult } from '../utils/fuzzyMatcher.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { GeminiClient } from '../core/client.js';
import { Config, ApprovalMode } from '../config/config.js';
import { ensureCorrectEdit } from '../utils/editCorrector.js';
import { DEFAULT_DIFF_OPTIONS } from './diffOptions.js';
import { ReadFileTool } from './read-file.js';
import { ModifiableTool, ModifyContext } from './modifiable-tool.js';

type EditError = { display: string; raw: string };

/**
 * Parameters for the Edit tool
 */
export interface EditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

  /**
   * The text to replace
   */
  old_string: string;

  /**
   * The text to replace it with
   */
  new_string: string;

  /**
   * Number of replacements expected. Defaults to 1 if not specified.
   * Use when you want to replace multiple occurrences.
   */
  expected_replacements?: number;

  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  occurrences: number;
  error?: { display: string; raw: string };
  isNewFile: boolean;
}

/**
 * Implementation of the Edit tool logic
 */
export class EditTool
  extends BaseTool<EditToolParams, ToolResult>
  implements ModifiableTool<EditToolParams>
{
  static readonly Name = 'replace';
  private readonly config: Config;
  private readonly rootDirectory: string;
  private readonly client: GeminiClient;

  /**
   * Creates a new instance of the EditLogic
   * @param rootDirectory Root directory to ground this tool in.
   */
  constructor(config: Config) {
    super(
      EditTool.Name,
      'Edit',
      `Replaces text within a file. By default, replaces a single occurrence, but can replace multiple occurrences when \`expected_replacements\` is specified. This tool requires providing significant context around the change to ensure precise targeting. Always use the ${ReadFileTool.Name} tool to examine the file's current content before attempting a text replacement.

      The user has the ability to modify the \`new_string\` content. If modified, this will be stated in the response.

Expectation for required parameters:
1. \`file_path\` MUST be an absolute path; otherwise an error will be thrown.
2. \`old_string\` MUST be the exact literal text to replace (including all whitespace, indentation, newlines, and surrounding code etc.).
3. \`new_string\` MUST be the exact literal text to replace \`old_string\` with (also including all whitespace, indentation, newlines, and surrounding code etc.). Ensure the resulting code is correct and idiomatic.
4. NEVER escape \`old_string\` or \`new_string\`, that would break the exact literal text requirement.
**Important:** If ANY of the above are not satisfied, the tool will fail. CRITICAL for \`old_string\`: Must uniquely identify the single instance to change. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. If this string matches multiple locations, or does not match exactly, the tool will fail.
**Multiple replacements:** Set \`expected_replacements\` to the number of occurrences you want to replace. The tool will replace ALL occurrences that match \`old_string\` exactly. Ensure the number of replacements matches your expectation.`,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: 'string',
          },
          old_string: {
            description:
              'The exact literal text to replace, preferably unescaped. For single replacements (default), include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. For multiple replacements, specify expected_replacements parameter. If this string is not the exact literal text (i.e. you escaped it) or does not match exactly, the tool will fail.',
            type: 'string',
          },
          new_string: {
            description:
              'The exact literal text to replace `old_string` with, preferably unescaped. Provide the EXACT text. Ensure the resulting code is correct and idiomatic.',
            type: 'string',
          },
          expected_replacements: {
            type: 'number',
            description:
              'Number of replacements expected. Defaults to 1 if not specified. Use when you want to replace multiple occurrences.',
            minimum: 1,
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: 'object',
      },
    );
    this.config = config;
    this.rootDirectory = path.resolve(this.config.getTargetDir());
    this.client = config.getGeminiClient();
  }

  /**
   * Checks if a path is within the root directory.
   * @param pathToCheck The absolute path to check.
   * @returns True if the path is within the root directory, false otherwise.
   */
  private isWithinRoot(pathToCheck: string): boolean {
    const normalizedPath = path.normalize(pathToCheck);
    const normalizedRoot = this.rootDirectory;
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;
    return (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(rootWithSep)
    );
  }

  /**
   * Validates the parameters for the Edit tool
   * @param params Parameters to validate
   * @returns Error message string or null if valid
   */
  validateToolParams(params: EditToolParams): string | null {
    if (
      this.schema.parameters &&
      !SchemaValidator.validate(
        this.schema.parameters as Record<string, unknown>,
        params,
      )
    ) {
      return 'Parameters failed schema validation.';
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    if (!this.isWithinRoot(params.file_path)) {
      return `File path must be within the root directory (${this.rootDirectory}): ${params.file_path}`;
    }

    return null;
  }

  /**
   * Reads and normalizes the content of a file.
   * @returns An object with the file content and a flag indicating if it exists.
   * @throws Any file system error other than 'File Not Found'.
   */
  private _readFileContent(filePath: string): {
    content: string | null;
    exists: boolean;
  } {
    try {
      const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      return { content, exists: true };
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { content: null, exists: false };
      }
      // Rethrow unexpected FS errors (permissions, etc.)
      throw err;
    }
  }

  /**
   * Validates an edit operation against an existing file's content, performs corrections,
   * and uses fuzzy matching as a fallback.
   * @returns An `EditError` object if validation fails, otherwise `null`.
   */
  private async _validateAndCorrectEdit(
    params: EditToolParams,
    currentContent: string,
    correctedEditResult: {
      // Pass this in to avoid re-calculating
      params: { old_string: string; new_string: string };
      occurrences: number;
    },
  ): Promise<EditError | null> {
    const { occurrences } = correctedEditResult;
    const expectedReplacements = params.expected_replacements ?? 1;

    if (occurrences === expectedReplacements) {
      return null; // The edit is valid as is.
    }

    // --- Handle Failure Cases ---

    if (occurrences === 0) {
      const fuzzyMatch = findBestFuzzyMatch(
        currentContent,
        correctedEditResult.params.old_string,
      );
      if (fuzzyMatch) {
        return this.createInstructiveFailureMessage(
          fuzzyMatch,
          correctedEditResult.params.old_string,
        );
      }
      return {
        display: 'Failed to edit, could not find the string to replace.',
        raw: `Failed to edit, 0 occurrences found for old_string in ${params.file_path}. No edits made. The exact text in old_string was not found. Please use the ${ReadFileTool.Name} tool to verify file content and your parameters.`,
      };
    } else {
      // occurrences !== expectedReplacements (and not 0)
      const occurrenceTerm =
        expectedReplacements === 1 ? 'occurrence' : 'occurrences';
      return {
        display: `Failed to edit, expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences}.`,
        raw: `Failed to edit, Expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences} for old_string in file: ${params.file_path}. No change was made.`,
      };
    }
  }

  private _applyReplacement(
    currentContent: string | null,
    oldString: string,
    newString: string,
    isNewFile: boolean,
  ): string {
    if (isNewFile) {
      return newString;
    }
    if (currentContent === null) {
      // Should not happen if not a new file, but defensively return empty or newString if oldString is also empty
      return oldString === '' ? newString : '';
    }
    // If oldString is empty and it's not a new file, do not modify the content.
    if (oldString === '' && !isNewFile) {
      return currentContent;
    }
    return currentContent.replaceAll(oldString, newString);
  }

  /**
   * Calculates the potential outcome of an edit operation.
   * @param params Parameters for the edit operation
   * @returns An object describing the potential edit outcome
   * @throws File system errors if reading the file fails unexpectedly (e.g., permissions)
   */
  private async calculateEdit(
    params: EditToolParams,
    abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    const { content: currentContent, exists: fileExists } =
      this._readFileContent(params.file_path);

    // Attempting to create a new file. This is a valid terminal state.
    if (params.old_string === '' && !fileExists) {
      return {
        currentContent: null,
        newContent: params.new_string,
        occurrences: 1,
        isNewFile: true,
      };
    }

    // File does not exist, but the edit is not a file creation.
    if (!fileExists) {
      return {
        currentContent: null,
        newContent: '',
        occurrences: 0,
        isNewFile: false,
        error: {
          display:
            'File not found. Cannot apply edit. Use an empty old_string to create a new file.',
          raw: `File not found: ${params.file_path}`,
        },
      };
    }

    // File exists, but `currentContent` is unexpectedly null (unlikely but for defensive coding).
    if (currentContent === null) {
      return {
        currentContent: null,
        newContent: '',
        occurrences: 0,
        isNewFile: false,
        error: {
          display: 'Failed to read content of file.',
          raw: `Unexpected Error: Failed to read content of existing file: ${params.file_path}`,
        },
      };
    }

    if (params.old_string === '') {
      const isNoOp = params.new_string === '';
      return {
        currentContent,
        newContent: currentContent,
        occurrences: 0,
        isNewFile: false,
        error: isNoOp
          ? {
              display:
                'Agent proposed an empty edit on an existing file. No action was taken.',
              raw: `Error: The tool was called with both \`old_string\` and \`new_string\` as empty strings on an existing file. This is an invalid no-op.

This error typically indicates one of two common reasoning failures:
1.  **State Desynchronization:** You may be trying to apply an edit that has *already been completed* in a previous step. Your internal memory of the file is likely stale.
2.  **Task Completion Hallucination:** You may have concluded no change was needed but incorrectly called the edit tool to signify task completion.

**Action:** Do not attempt this edit again. Instead, use the \`${ReadFileTool.Name}\` tool to get the file's current, up-to-date content. Then, compare the fresh content to your original goal to decide if any *further* action is truly necessary. If no further action is needed, report your findings to the user.`,
            }
          : {
              display:
                'Failed to edit. Attempted to create a file that already exists.',
              raw: `Error: You attempted to create a file at ${params.file_path} (by providing an empty \`old_string\`), but it already exists.`,
            },
      };
    }

    // --- Main Edit Logic ---

    // Perform the programmatic correction first.
    const correctedEdit = await ensureCorrectEdit(
      currentContent,
      params,
      this.client,
      abortSignal,
    );

    // Validate the corrected edit, using fuzzy matching as a fallback.
    const validationError = await this._validateAndCorrectEdit(
      params,
      currentContent,
      correctedEdit,
    );

    if (validationError) {
      return {
        currentContent,
        newContent: currentContent,
        occurrences: 0,
        isNewFile: false,
        error: validationError,
      };
    }

    // --- Happy Path: The edit is valid and can be applied ---

    const newContent = this._applyReplacement(
      currentContent,
      correctedEdit.params.old_string,
      correctedEdit.params.new_string,
      false, // isNewFile is false at this point
    );

    return {
      currentContent,
      newContent,
      occurrences: correctedEdit.occurrences,
      isNewFile: false,
    };
  }

  private createInstructiveFailureMessage(
    fuzzyMatch: FuzzyMatchResult,
    problematicOldString: string,
  ): { display: string; raw: string } {
    const correctiveDiff = Diff.createPatch(
      'diff', // Placeholder filename needed for diff utility
      problematicOldString,
      fuzzyMatch.bestMatch,
      'Your `old_string` (not found)',
      'Closest Match in File (at line ' + (fuzzyMatch.startLine + 1) + ')',
    );

    const rawErrorMessageForLlm = `Error: The tool failed because the \`old_string\` you provided was not found in the file.
This often happens due to small differences in whitespace, newlines, or characters. Your previous attempt was automatically corrected, but that also failed.

A fuzzy search has identified a close match. Review the following diff carefully to understand the exact differences.

\`\`\`diff
${correctiveDiff}
\`\`\`

Action: In your next tool call, modify the \`old_string\` parameter to be an *exact, character-for-character copy* of the "Closest Match in File" block from the diff above.`;

    const displayMessageForUser = `Failed to apply edit: The exact text to replace was not found. A close match was identified, and the agent has been instructed to correct its request.`;

    return {
      display: displayMessageForUser,
      raw: rawErrorMessageForLlm,
    };
  }

  /**
   * Handles the confirmation prompt for the Edit tool in the CLI.
   * It needs to calculate the diff to show the user.
   */
  async shouldConfirmExecute(
    params: EditToolParams,
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    const validationError = this.validateToolParams(params);
    if (validationError) {
      console.error(
        `[EditTool Wrapper] Attempted confirmation with invalid parameters: ${validationError}`,
      );
      return false;
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(params, abortSignal);
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
      title: `Confirm Edit: ${shortenPath(makeRelative(params.file_path, this.rootDirectory))}`,
      fileName,
      fileDiff,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  getDescription(params: EditToolParams): string {
    if (!params.file_path || !params.old_string || !params.new_string) {
      return `Model did not provide valid parameters for edit tool`;
    }
    const relativePath = makeRelative(params.file_path, this.rootDirectory);
    if (params.old_string === '') {
      return `Create ${shortenPath(relativePath)}`;
    }

    const oldStringSnippet =
      params.old_string.split('\n')[0].substring(0, 30) +
      (params.old_string.length > 30 ? '...' : '');
    const newStringSnippet =
      params.new_string.split('\n')[0].substring(0, 30) +
      (params.new_string.length > 30 ? '...' : '');

    if (params.old_string === params.new_string) {
      return `No file changes to ${shortenPath(relativePath)}`;
    }
    return `${shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }

  /**
   * Executes the edit operation with the given parameters.
   * @param params Parameters for the edit operation
   * @returns Result of the edit operation
   */
  async execute(
    params: EditToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
      };
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(params, signal);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing edit: ${errorMsg}`,
        returnDisplay: `Error preparing edit: ${errorMsg}`,
      };
    }

    if (editData.error) {
      return {
        llmContent: editData.error.raw,
        returnDisplay: `Error: ${editData.error.display}`,
      };
    }

    try {
      this.ensureParentDirectoriesExist(params.file_path);
      fs.writeFileSync(params.file_path, editData.newContent, 'utf8');

      let displayResult: ToolResultDisplay;
      if (editData.isNewFile) {
        displayResult = `Created ${shortenPath(makeRelative(params.file_path, this.rootDirectory))}`;
      } else {
        // Generate diff for display, even though core logic doesn't technically need it
        // The CLI wrapper will use this part of the ToolResult
        const fileName = path.basename(params.file_path);
        const fileDiff = Diff.createPatch(
          fileName,
          editData.currentContent ?? '', // Should not be null here if not isNewFile
          editData.newContent,
          'Current',
          'Proposed',
          DEFAULT_DIFF_OPTIONS,
        );
        displayResult = { fileDiff, fileName };
      }

      const llmSuccessMessageParts = [
        editData.isNewFile
          ? `Created new file: ${params.file_path} with provided content.`
          : `Successfully modified file: ${params.file_path} (${editData.occurrences} replacements).`,
      ];
      if (params.modified_by_user) {
        llmSuccessMessageParts.push(
          `User modified the \`new_string\` content to be: ${params.new_string}.`,
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

  getModifyContext(_: AbortSignal): ModifyContext<EditToolParams> {
    return {
      getFilePath: (params: EditToolParams) => params.file_path,
      getCurrentContent: async (params: EditToolParams): Promise<string> => {
        try {
          return fs.readFileSync(params.file_path, 'utf8');
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: EditToolParams): Promise<string> => {
        try {
          const currentContent = fs.readFileSync(params.file_path, 'utf8');
          return this._applyReplacement(
            currentContent,
            params.old_string,
            params.new_string,
            params.old_string === '' && currentContent === '',
          );
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      createUpdatedParams: (
        oldContent: string,
        modifiedProposedContent: string,
        originalParams: EditToolParams,
      ): EditToolParams => ({
        ...originalParams,
        old_string: oldContent,
        new_string: modifiedProposedContent,
        modified_by_user: true,
      }),
    };
  }
}
