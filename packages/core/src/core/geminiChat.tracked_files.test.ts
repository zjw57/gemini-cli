/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Content, Models, GenerateContentConfig } from '@google/genai';
import { GeminiChat } from './geminiChat.js';
import { Config } from '../config/config.js';

// Mocks
const mockModelsModule = {
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
  countTokens: vi.fn(),
  embedContent: vi.fn(),
  batchEmbedContents: vi.fn(),
} as unknown as Models;

const mockConfig = {
  getSessionId: () => 'test-session-id',
} as unknown as Config;

import { createFileContextPart } from '../utils/fileContextUtils.js';

describe('GeminiChat - Tracked File History Sanitization', () => {
  let chat: GeminiChat;
  const model = 'gemini-pro';
  const config: GenerateContentConfig = {};

  beforeEach(() => {
    vi.clearAllMocks();
    chat = new GeminiChat(mockConfig, mockModelsModule, model, config, []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should replace file content with a summary in the history', () => {
    const userInput: Content = {
      role: 'user',
      parts: [
        { text: 'User input' },
        createFileContextPart('/test/file.txt', 'This is file content.'),
      ],
    };

    const modelOutput: Content[] = [
      { role: 'model', parts: [{ text: 'Model output' }] },
    ];

    // @ts-expect-error - private method
    chat.recordHistory(userInput, modelOutput);

    const history = chat.getHistory();
    expect(history).toHaveLength(2);
    const userHistory = history[0];
    expect(userHistory.parts).toBeDefined();
    expect(userHistory.parts).toHaveLength(2);
    expect(userHistory.parts![0].text).toBe('User input');
    expect(userHistory.parts![1].text).toBe(
      '[CONTEXT] File: /test/file.txt'
    );
  });

  it('should update the history summary as files are added and removed over time', () => {
    const modelOutput: Content[] = [
      { role: 'model', parts: [{ text: 'OK' }] },
    ];

    // 1. Track file1
    const userInput1: Content = {
      role: 'user',
      parts: [
        { text: 'Message 1' },
        createFileContextPart('/test/file1.txt', 'Content 1'),
      ],
    };
    // @ts-expect-error - private method
    chat.recordHistory(userInput1, modelOutput);
    let history = chat.getHistory();
    expect(history[0].parts).toBeDefined();
    expect(history[0].parts).toHaveLength(2);
    expect(history[0].parts![0].text).toBe('Message 1');
    expect(history[0].parts![1].text).toBe('[CONTEXT] File: /test/file1.txt');

    // 2. Track file2 (file1 is still tracked)
    const userInput2: Content = {
      role: 'user',
      parts: [
        { text: 'Message 2' },
        createFileContextPart('/test/file1.txt', 'Content 1'),
        createFileContextPart('/test/file2.txt', 'Content 2'),
      ],
    };
    // @ts-expect-error - private method
    chat.recordHistory(userInput2, modelOutput);
    history = chat.getHistory();
    expect(history[2].parts).toBeDefined();
    expect(history[2].parts).toHaveLength(3);
    expect(history[2].parts![0].text).toBe('Message 2');
    expect(history[2].parts![1].text).toBe('[CONTEXT] File: /test/file1.txt');
    expect(history[2].parts![2].text).toBe('[CONTEXT] File: /test/file2.txt');

    // 3. Untrack file1
    const userInput3: Content = {
      role: 'user',
      parts: [
        { text: 'Message 3' },
        createFileContextPart('/test/file2.txt', 'Content 2'),
      ],
    };
    // @ts-expect-error - private method
    chat.recordHistory(userInput3, modelOutput);
    history = chat.getHistory();
    expect(history[4].parts).toBeDefined();
    expect(history[4].parts).toHaveLength(2);
    expect(history[4].parts![0].text).toBe('Message 3');
    expect(history[4].parts![1].text).toBe(
      '[CONTEXT] File: /test/file2.txt'
    );
  });

  it('should not alter history if no tracked files are present', () => {
    const userInput: Content = {
      role: 'user',
      parts: [{ text: 'A normal message' }],
    };
    const modelOutput: Content[] = [
      { role: 'model', parts: [{ text: 'A normal response' }] },
    ];

    // @ts-expect-error - private method
    chat.recordHistory(userInput, modelOutput);

    const history = chat.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(userInput);
    expect(history[1]).toEqual(modelOutput[0]);
  });
});