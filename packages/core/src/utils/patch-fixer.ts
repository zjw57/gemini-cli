/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Content, Type } from '@google/genai';
import { type GeminiClient } from '../core/client.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { type Hunk } from './patcher.js';

const PATCH_FIXER_SYSTEM_PROMPT = `You are an automated patch-fixing utility. Your task is to generate a new patch in the **unified diff format** that correctly applies the *exact same substantive change* as a failed hunk, but with updated context lines that match the provided source file.

RULES:
- Your output MUST be only the raw diff content, starting with '--- a/' or '@@'.
- Do NOT add any explanations, markdown, or other text.
- The substantive change (the lines being added or removed) must be identical to the failed hunk. Only the context lines should change.`;

const PATCH_FIXER_USER_PROMPT = `
**Source File:**
{filepath}
---
\
{currentContent}
\
**Failed Hunk:**
\
{hunkAsString}
\
`;

const CorrectedPatchResponseSchema = {
  type: Type.OBJECT,
  properties: {
    patch: { type: Type.STRING },
  },
  required: ['patch'],
};

/**
 * Attempts to fix a failed patch hunk by using an LLM to generate a new,
 * corrected patch with updated context lines.
 *
 * @param failedHunk The hunk object that failed to apply.
 * @param currentContent The current content of the file to be patched.
 * @param geminiClient The Gemini client to use for the LLM call.
 * @param abortSignal An abort signal to cancel the operation.
 * @returns A string containing the new, corrected patch in unified diff format.
 */
export async function fixFailedHunk(
  failedHunk: Hunk,
  filepath: string,
  currentContent: string,
  geminiClient: GeminiClient,
  abortSignal: AbortSignal,
): Promise<string> {
  // The originalHunk property contains the raw string representation of the hunk.
  const hunkAsString = failedHunk.originalHunk;

  const prompt = PATCH_FIXER_USER_PROMPT.replace(
    '{currentContent}',
    currentContent,
  )
    .replace('{hunkAsString}', hunkAsString)
    .replace('{filepath}', filepath);

  const contents: Content[] = [
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const result = (await geminiClient.generateJson(
    contents,
    CorrectedPatchResponseSchema,
    abortSignal,
    DEFAULT_GEMINI_FLASH_MODEL,
    { systemInstruction: { role: 'system', parts: [{ text: PATCH_FIXER_SYSTEM_PROMPT }] } },
  )) as { patch: string };

  // The LLM may wrap the diff in markdown, so we remove it.
  const cleanedResult = result.patch.replace(/^```diff\n|```$/g, '').trim();

  return cleanedResult;
}