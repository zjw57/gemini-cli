/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { toGenerateContentResponse } from './responseConverter.js';
import { Event } from '@google/adk';
import type { Content } from '@google/genai';

describe('responseConverter', () => {
  it('should convert an Event to a GenerateContentResponse', () => {
    const content: Content = {
      parts: [{ text: 'hello' }],
      role: 'model',
    };
    const event = new Event({ content });

    const response = toGenerateContentResponse(event);

    expect(response.candidates).toHaveLength(1);
    expect(response.candidates?.[0].content).toEqual(content);
    expect(response.text).toBe('hello');
  });
});
