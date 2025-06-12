/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part } from '@google/genai';

// This is not exported, as per instructions.
const GEMINI_TRACKED_FILE_MARKER = 'GEMINI_TRACKED_FILE_V1:';

interface FileContextInfo {
  isFile: boolean;
  relativePath?: string;
  absolutePath?: string;
}

/**
 * Creates a `Part` object containing the specially formatted marker
 * for a tracked file, to be sent to the model.
 *
 * @param relativePath The relative path of the file.
 * @param content The full content of the file.
 * @param absolutePath The absolute path of the file.
 * @returns A `Part` object with the marked-up text.
 */
export function createFileContextPart(
  relativePath: string,
  content: string,
  absolutePath?: string,
): Part {
  const markerPayload = JSON.stringify({ relativePath, absolutePath });
  return { text: `${GEMINI_TRACKED_FILE_MARKER}${markerPayload}\n${content}` };
}

/**
 * Detects if a Part is a file context part.
 * @param part The Part to check.
 * @returns Information about the file context if it is one.
 */
export function isFileContextPart(part: Part): FileContextInfo {
  if (part.text?.startsWith(GEMINI_TRACKED_FILE_MARKER)) {
    try {
      const endOfMarker = part.text.indexOf('\n');
      const markerJson =
        endOfMarker === -1
          ? part.text.substring(GEMINI_TRACKED_FILE_MARKER.length)
          : part.text.substring(
              GEMINI_TRACKED_FILE_MARKER.length,
              endOfMarker,
            );
      const data = JSON.parse(markerJson);
      if (data.relativePath) {
        return {
          isFile: true,
          relativePath: data.relativePath,
          absolutePath: data.absolutePath,
        };
      }
    } catch (e) {
      // Malformed, treat as not a file context part.
    }
  }
  return { isFile: false };
}

/**
 * If a part is a file context, returns a new one with the summarized version.
 * @param part The part to summarize.
 * @returns A summarized part if it was a file context part, otherwise the original part.
 */
export function summarizeFileContext(part: Part): Part {
  const fileInfo = isFileContextPart(part);
  if (fileInfo.isFile && fileInfo.relativePath) {
    let text = `[CONTEXT] File: ${fileInfo.relativePath}`;
    if (fileInfo.absolutePath) {
      text += ` (${fileInfo.absolutePath})`;
    }
    return {
      text,
    };
  }
  return part;
}

/**
 * Replaces any parts that are full file contexts with just a summary.
 * @param parts The parts to summarize.
 * @returns A new array of parts with file contexts summarized.
 */
export function summarizePartsFileContext(parts: Part[]): Part[] {
  return parts.map(summarizeFileContext);
}

/**
 * Sanitizes a user-provided Content object by replacing any parts containing
 * tracked file content with a simple summary part.
 *
 * @param userInput The original user Content object.
 * @returns A new Content object with file content replaced by a summary.
 *          Returns the original object if no sanitization is needed.
 */
export function sanitizeUserContent(userInput: Content): Content {
  if (!userInput.parts) {
    return userInput;
  }

  const partsWithFileContextsSummarized = summarizePartsFileContext(
    userInput.parts,
  );

  // Avoid creating a new object if no parts were changed.
  const hasChanged = userInput.parts.some(
    (part, i) => part !== partsWithFileContextsSummarized[i],
  );

  if (!hasChanged) {
    return userInput;
  }

  return {
    role: userInput.role,
    parts: partsWithFileContextsSummarized,
  };
}
