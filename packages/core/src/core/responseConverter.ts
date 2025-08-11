/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentResponse,
  FinishReason,
  Candidate,
} from '@google/genai';
import { Event } from '@google/adk';

export function toGenerateContentResponse(
  event: Event,
): GenerateContentResponse {
  const candidates: Candidate[] = event.content
    ? [
        {
          content: event.content,
          finishReason: event.isFinalResponse()
            ? FinishReason.STOP
            : FinishReason.OTHER,
          index: 0,
          safetyRatings: [],
        },
      ]
    : [];

  return {
    candidates,
    text: (event.content?.parts?.[0]?.text as string) || '',
  } as GenerateContentResponse;
}
