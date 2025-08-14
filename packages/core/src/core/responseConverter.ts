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
  
  const candidate: Candidate = {
    content: event.content,
    finishReason: event.errorCode ? event.errorCode as FinishReason : undefined,
    finishMessage: event.errorMessage || '',
    groundingMetadata: event.groundingMetadata,
    index: 0,
    safetyRatings: [],
  } as Candidate;

  const response: GenerateContentResponse = {
    candidates: [candidate],
    text: (event.content?.parts?.[0]?.text as string) || '',
    functionCalls: event.getFunctionCalls(),
    usageMetadata: event.usageMetadata
  } as GenerateContentResponse;

  return response;
}
