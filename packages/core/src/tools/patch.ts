/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type {
  ToolCallConfirmationDetails,
  ToolEditConfirmationDetails,
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from './tools.js';
import { BaseDeclarativeTool, Kind, ToolConfirmationOutcome } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import {
  parseSearchReplace,
  applySearchReplaceToContent,
} from '../utils/patcher.js';
import type { SearchReplaceOp, PatchError } from '../utils/patcher.js';
import { IdeClient, IDEConnectionStatus } from '../ide/ide-client.js';
import { fixFailedSearchReplace } from '../utils/patch-fixer.js';
import type { PatchFixResult } from '../utils/patch-fixer.js';

/**
 * Parameters for the Patch tool using Search/Replace format.
 */
export interface PatchToolParams {
  /** The path to the file to edit. */
  file_path: string;
  /** A series of SEARCH and REPLACE blocks. */
  search_replace_diff: string;
  /** The high-level instruction for the edit. */
  instruction: string;
}

interface HealedOpInfo {
  op: SearchReplaceOp;
  explanation: string;
}

interface CalculatedPatch {
  originalContent: string;
  newContent: string;
  appliedOps: SearchReplaceOp[];
  healedOps: HealedOpInfo[];
  failedOps: Array<{ op: SearchReplaceOp; error: PatchError }>;
  noOpOps: SearchReplaceOp[];
  error?: { display: string; raw: string; type: ToolErrorType };
}

class PatchToolInvocation
  implements ToolInvocation<PatchToolParams, ToolResult>
{
  private calculatedPatchPromise?: Promise<CalculatedPatch>;

  constructor(
    private readonly config: Config,
    public params: PatchToolParams,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path }];
  }

  private async _calculatePatch(signal: AbortSignal): Promise<CalculatedPatch> {
    const { file_path, search_replace_diff, instruction } = this.params;
    let ops: SearchReplaceOp[];

    try {
      ops = parseSearchReplace(search_replace_diff);
      if (ops.length === 0) {
        return {
          originalContent: '', newContent: '', appliedOps: [], healedOps: [], failedOps: [], noOpOps: [],
          error: {
            display: 'The provided search_replace_diff was empty or invalid.',
            raw: 'Patch failed: The search_replace_diff parameter did not contain any valid operations.',
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }
    } catch (e: unknown) {
      return {
        originalContent: '', newContent: '', appliedOps: [], healedOps: [], failedOps: [], noOpOps: [],
        error: {
          display: `Failed to parse the search_replace_diff: ${(e as Error).message}`,
          raw: `Patch failed during parsing: ${(e as Error).message}`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    let originalContent = '';
    const absolutePath = path.join(this.config.getTargetDir(), file_path);
    try {
      originalContent = await this.config
        .getFileSystemService()
        .readTextFile(absolutePath);
      originalContent = originalContent.replace(/\r\n/g, '\n');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
         // Allow creation of new files if the first op is a pure insert
         if (!(ops[0].search === '' && ops[0].replace !== '')) {
            return {
              originalContent: '', newContent: '', appliedOps: [], healedOps: [], failedOps: [], noOpOps: [],
              error: {
                display: `File not found: ${file_path}`,
                raw: `Patch failed: File not found: ${file_path}`,
                type: ToolErrorType.FILE_NOT_FOUND,
              },
            };
         }
      } else {
        throw err;
      }
    }

    const {
      newContent: firstPassContent,
      failedOps: firstPassFailures,
      noOpOps: firstPassNoOps,
      appliedOps: firstPassApplied,
    } = applySearchReplaceToContent(originalContent, ops);

    const finalFailedOps: Array<{ op: SearchReplaceOp; error: PatchError }> = [];
    const currentHealedOps: HealedOpInfo[] = [];
    let contentAfterHealing = firstPassContent;

    if (firstPassFailures.length > 0) {
      console.log(`[PatchTool] ${firstPassFailures.length} ops failed on first pass for ${file_path}. Attempting to heal...`);
      for (const failure of firstPassFailures) {
        try {
          const fixResult: PatchFixResult = await fixFailedSearchReplace(
            failure.op,
            file_path,
            contentAfterHealing,
            failure.error.message,
            instruction,
            this.config.getGeminiClient(),
            signal,
          );

          if (fixResult.changes_already_present) {
            console.log(`[PatchTool] Healing indicated changes already present for an op in ${file_path}: ${fixResult.explanation}`);
            firstPassNoOps.push(failure.op);
            continue;
          }

          if (!fixResult.corrected_search_replace_diff) {
            throw new Error('LLM fixer returned no correction.');
          }

          const newlyHealedOps = parseSearchReplace(fixResult.corrected_search_replace_diff);
          if (!newlyHealedOps || newlyHealedOps.length === 0) {
            throw new Error('LLM fixer returned an empty or invalid search_replace_diff.');
          }

          console.log(`[PatchTool] LLM fixer proposed a correction for ${file_path}:\n${fixResult.corrected_search_replace_diff}`);

          const {
            newContent: healedContent,
            failedOps: healedFailures,
            appliedOps: healedApplied,
          } = applySearchReplaceToContent(contentAfterHealing, newlyHealedOps);

          if (healedFailures.length > 0) {
            throw new Error(`Healed op failed to apply: ${healedFailures[0].error.message}`);
          }

          contentAfterHealing = healedContent;
          healedApplied.forEach((op) =>
            currentHealedOps.push({
              op: op,
              explanation: fixResult.explanation,
            }),
          );
          console.log(`[PatchTool] Successfully applied healed op to ${file_path}. Explanation: ${fixResult.explanation}`);
        } catch (e: unknown) {
          console.error(`[PatchTool] Failed to heal op for ${file_path}: ${(e as Error).message}`);
          finalFailedOps.push(failure);
        }
      }
    }

    return {
      originalContent,
      newContent: contentAfterHealing,
      appliedOps: firstPassApplied,
      healedOps: currentHealedOps,
      failedOps: finalFailedOps,
      noOpOps: firstPassNoOps,
    };
  }

  private calculatePatch(signal: AbortSignal): Promise<CalculatedPatch> {
    if (!this.calculatedPatchPromise) {
      this.calculatedPatchPromise = this._calculatePatch(signal);
    }
    return this.calculatedPatchPromise;
  }

  async shouldConfirmExecute(
    signal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.YOLO) {
      return false;
    }

    const patchData = await this.calculatePatch(signal);

    if (patchData.error) {
      console.log(`Error: ${patchData.error.display ?? 'Unknown error'}`);
      return false;
    }

    if (patchData.newContent === patchData.originalContent && patchData.failedOps.length === 0) {
      console.log('No changes to apply.');
      return false;
    }
     if (patchData.appliedOps.length === 0 && patchData.healedOps.length === 0 && patchData.failedOps.length > 0) {
      const firstError = patchData.failedOps[0]?.error.message;
      console.log(
        `Error: No changes could be applied from the patch. First error: ${firstError || 'Unknown error'}`,
      );
      return false;
    }

    const title = patchData.failedOps.length > 0
      ? `Confirm Partial Edit for ${path.basename(this.params.file_path)}`
      : `Confirm Edit for ${path.basename(this.params.file_path)}`;

    const ideClient = await IdeClient.getInstance();
    const ideConfirmation =
      this.config.getIdeMode() &&
      ideClient?.getConnectionStatus().status === IDEConnectionStatus.Connected
        ? await ideClient.openDiff(
            this.params.file_path,
            patchData.newContent,
          )
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title,
      fileName: path.basename(this.params.file_path),
      filePath: this.params.file_path,
      // We don't have a standard diff, so show full content
      fileDiff: `--- a/${this.params.file_path}\n+++ b/${this.params.file_path}\n... content diff ...`,
      originalContent: patchData.originalContent,
      newContent: patchData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.YOLO);
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  getDescription(): string {
    return `Apply search and replace edits to ${shortenPath(makeRelative(this.params.file_path, this.config.getTargetDir()))}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const patchData = await this.calculatePatch(signal);
    const { file_path } = this.params;

    if (patchData.error) {
      return {
        llmContent: patchData.error.raw,
        returnDisplay: `Error: ${patchData.error.display}`,
        error: { message: patchData.error.raw, type: patchData.error.type },
      };
    }

    const { originalContent, newContent, appliedOps, healedOps, failedOps, noOpOps } = patchData;

    if (newContent === originalContent && failedOps.length === 0) {
      return {
        llmContent: 'The file content already matches the desired state. No changes were needed.',
        returnDisplay: '✅ No changes needed.',
      };
    }

    if (appliedOps.length === 0 && healedOps.length === 0 && failedOps.length > 0) {
      let failedDetail = 'The following operations failed:\n';
      failedOps.forEach(f => {
        failedDetail += `\n--- FAILED OP ---\n${f.op.originalBlock}\nError: ${f.error.message}\n`;
      });
      return {
        llmContent: `Patch failed for ${file_path}. No operations could be applied, even after attempting to heal.\n${failedDetail}`,
        returnDisplay: `Error: No changes could be applied to ${file_path}.`,
        error: {
          message: `Patch failed for ${file_path}. No operations could be applied.`,
          type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
        },
      };
    }

    try {
      if (newContent !== originalContent) {
        const absolutePath = path.join(this.config.getTargetDir(), file_path);
        await this.config.getFileSystemService().writeTextFile(absolutePath, newContent);
      }

      let llmContent = `Successfully applied changes to ${file_path}.`;
      let returnDisplay = `Applied changes to ${file_path}.`;
      const totalOps = appliedOps.length + healedOps.length + failedOps.length + noOpOps.length;
      const successfulOps = appliedOps.length + healedOps.length;

      if (healedOps.length > 0) {
        llmContent += `\n\n${healedOps.length} operation(s) required automated healing:`;
        healedOps.forEach(h => {
          llmContent += `\n- Healed Op: ${h.op.originalBlock.split('\n')[1]} -> ${h.op.replace.split('\n')[0]}... Explanation: ${h.explanation}`;
        });
      }
      if (failedOps.length > 0) {
        returnDisplay = `Partially applied changes to ${file_path} (${successfulOps}/${totalOps} ops successful).`;
        llmContent += `\n\n${failedOps.length} operation(s) FAILED to apply for ${file_path}:`;
        failedOps.forEach(f => {
          llmContent += `\n--- FAILED OP ---\n${f.op.originalBlock}\nError: ${f.error.message}`;
        });
      }
      if (noOpOps.length > 0) {
        llmContent += `\n\n${noOpOps.length} operation(s) were skipped as no-ops (already present).`;
      }

      return { llmContent, returnDisplay };
    } catch (e: unknown) {
      return {
        llmContent: `Error writing file ${file_path}: ${(e as Error).message}`,
        returnDisplay: `Error applying patch: ${(e as Error).message}`,
        error: { message: (e as Error).message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }
  }
}

/**
 * Implementation of the Patch tool using Search/Replace format.
 */
export class PatchTool extends BaseDeclarativeTool<
  PatchToolParams,
  ToolResult
> {
  static readonly Name = 'patch';
  constructor(private readonly config: Config) {
    super(
      PatchTool.Name,
      'Patch',
      `Applies a series of search and replace operations to a single file.

**MANDATORY WORKFLOW:**
1.  Read the file content before generating the 'search_replace_diff'.
2.  If the application fails, the tool will attempt to self-heal the SEARCH blocks.
3.  If self-healing fails, use 'write_file' to overwrite the file.

**Format:**
The 'search_replace_diff' string consists of pairs of blocks:
SEARCH
(exact text to find)
REPLACE
(text to replace with)

Multiple pairs can be provided to perform sequential replacements.`,
      Kind.Edit,
      {
        properties: {
          file_path: {
            description: 'The path to the file to edit.',
            type: 'string',
          },
          search_replace_diff: {
            description: 'A string containing SEARCH and REPLACE blocks.',
            type: 'string',
          },
          instruction: {
            description: 'The high-level instruction for the edit, used for healing.',
            type: 'string',
          },
        },
        required: ['file_path', 'search_replace_diff', 'instruction'],
        type: 'object',
      },
    );
  }

  protected createInvocation(
    params: PatchToolParams,
  ): ToolInvocation<PatchToolParams, ToolResult> {
    return new PatchToolInvocation(this.config, params);
  }
}