/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Content, Type } from '@google/genai';
import { type GeminiClient } from '../core/client.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { type SearchReplaceOp } from './patcher.js';

// Adapted from repair_search_replace_si.txt
const PATCH_FIXER_PROMPT = `
You are an expert code-editing assistant specializing in debugging and correcting failed search-and-replace operations.

# Primary Goal
Your task is to analyze a failed edit attempt and provide a corrected \`search_replace_diff\` string that will apply the edit successfully. The correction should be as minimal as possible, staying very close to the original, failed \`search_replace_diff\` string.
It is important that you do no try to figure out if the instruction is correct. DO NOT GIVE ADVICE. Your only goal here is to do your best to perform the search and replace task!

# Description of how to form search and replace blocks in the search_replace_diff.
The search_replace_diff consists of pairs of blocks. Each pair starts with a line containing only "SEARCH", followed by the exact text to find, then a line containing only "REPLACE", followed by the text to replace it with.

Example:
SEARCH
The old line of code
REPLACE
The new line of code

# Input Context
You will be given:
1. The high-level instruction for the original edit: {instruction}
2. The exact \`search_replace_diff\` string that failed:
{failedBlock}
3. The error message that was produced: {errorMessage}
4. The full content of source file relevant to the diff:
---
{currentContent}
---

# Rules for Correction
1. **Minimal Correction:** Your new \`search_replace_diff\` string must be a close variation of the original. Focus on fixing issues like whitespace, indentation, line endings, or small contextual differences in SEARCH blocks.
2. **Explain the Fix:** Your \`explanation\` MUST state exactly why the original \`search_replace_diff\` failed and how your new \`search_replace_diff\` string resolves that specific failure. (e.g., "The original search failed due to incorrect indentation; the corrected search string includes the correct indentation.")
3. **Preserve Replaces:** Do NOT modify REPLACE blocks in \`search_replace_diff\` string unless the goal explicitly requires it and it was the source of the error. Your primary focus is fixing SEARCH blocks.
4. **Changes Already Present Case:** If ALL of the replacements in the original \`search_replace_diff\` string are already present in the file, set \`changes_already_present\` to true and explain why in the \`explanation\` and do not output a \`corrected_search_replace_diff\` as you are indicating no changes should be applied. Only set if ALL of the changes are already present. If a subset of the changes are present, then output a new corrected_search_replace_diff with only the new changes.
5. **Exactness:** The SEARCH blocks in \`search_replace_diff\` must be EXACT literal text from the file. Do not escape characters.

Please provide your response as a JSON object with the following fields:
- "explanation": Your explanation.
- "corrected_search_replace_diff": The corrected diff string (or null if changes_already_present is true).
- "changes_already_present": Boolean.
`;

const CorrectedPatchResponseSchema = {
  type: Type.OBJECT,
  properties: {
    explanation: { type: Type.STRING },
    corrected_search_replace_diff: { type: Type.STRING, nullable: true },
    changes_already_present: { type: Type.BOOLEAN },
  },
  required: ['explanation', 'changes_already_present'],
};

export interface PatchFixResult {
  explanation: string;
  corrected_search_replace_diff: string | null;
  changes_already_present: boolean;
}

/**
 * Attempts to fix a failed SearchReplaceOp.
 */
export async function fixFailedSearchReplace(
  failedOp: SearchReplaceOp,
  filepath: string,
  currentContent: string,
  errorMessage: string,
  instruction: string,
  geminiClient: GeminiClient,
  abortSignal: AbortSignal,
): Promise<PatchFixResult> {
  const prompt = PATCH_FIXER_PROMPT.replace('{currentContent}', currentContent)
    .replace('{failedBlock}', failedOp.originalBlock)
    .replace('{errorMessage}', errorMessage)
    .replace('{instruction}', instruction);

  const contents: Content[] = [
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ];

  const result = (await geminiClient.generateJson(
    contents,
    CorrectedPatchResponseSchema,
    abortSignal,
    DEFAULT_GEMINI_MODEL,
  )) as PatchFixResult;

  return result;
}
