/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Content, Part } from '@google/genai';
import {
  createFileContextPart,
  sanitizeUserContent,
  isFileContextPart,
  summarizeFileContext,
  summarizePartsFileContext,
} from './fileContextUtils.js';

// The test needs access to this, so we'll define it here.
// In the implementation it is not exported.
const GEMINI_TRACKED_FILE_MARKER = 'GEMINI_TRACKED_FILE_V1:';

describe('File Context Utils', () => {
  describe('createFileContextPart', () => {
    it('should create a correctly formatted file context part', () => {
      const part = createFileContextPart(
        'test/file.txt',
        'This is the content.',
      );
      const expectedPayload = JSON.stringify({
        relativePath: 'test/file.txt',
        absolutePath: undefined,
      });
      expect(part.text).toBe(
        `${GEMINI_TRACKED_FILE_MARKER}${expectedPayload}\nThis is the content.`,
      );
    });

    it('should create a correctly formatted file context part with absolute path', () => {
      const part = createFileContextPart(
        'test/file.txt',
        'This is the content.',
        '/abs/test/file.txt',
      );
      const expectedPayload = JSON.stringify({
        relativePath: 'test/file.txt',
        absolutePath: '/abs/test/file.txt',
      });
      expect(part.text).toBe(
        `${GEMINI_TRACKED_FILE_MARKER}${expectedPayload}\nThis is the content.`,
      );
    });
  });

  describe('isFileContextPart', () => {
    it('should return true and the path for a valid file context part', () => {
      const part = createFileContextPart('a/b.txt', 'content', '/abs/a/b.txt');
      const result = isFileContextPart(part);
      expect(result.isFile).toBe(true);
      expect(result.relativePath).toBe('a/b.txt');
      expect(result.absolutePath).toBe('/abs/a/b.txt');
    });

    it('should return true and the relative path for a valid file context part without absolute path', () => {
      const part = createFileContextPart('a/b.txt', 'content');
      const result = isFileContextPart(part);
      expect(result.isFile).toBe(true);
      expect(result.relativePath).toBe('a/b.txt');
      expect(result.absolutePath).toBeUndefined();
    });

    it('should return false for a regular text part', () => {
      const part: Part = { text: 'hello world' };
      const result = isFileContextPart(part);
      expect(result.isFile).toBe(false);
      expect(result.relativePath).toBeUndefined();
    });

    it('should return false for a part with a malformed marker', () => {
      const part: Part = { text: `${GEMINI_TRACKED_FILE_MARKER}{not-json}` };
      const result = isFileContextPart(part);
      expect(result.isFile).toBe(false);
      expect(result.relativePath).toBeUndefined();
    });

    it('should return false for a part with a marker but no relativePath', () => {
      const part: Part = {
        text: `${GEMINI_TRACKED_FILE_MARKER}${'{"foo":"bar"}'}`,
      };
      const result = isFileContextPart(part);
      expect(result.isFile).toBe(false);
      expect(result.relativePath).toBeUndefined();
    });
  });

  describe('summarizeFileContext', () => {
    it('should summarize a file context part', () => {
      const part = createFileContextPart('a/b.txt', 'content');
      const summaryPart = summarizeFileContext(part);
      expect(summaryPart.text).toBe('[CONTEXT] File: a/b.txt');
    });

    it('should summarize a file context part with absolute path', () => {
      const part = createFileContextPart('a/b.txt', 'content', '/abs/a/b.txt');
      const summaryPart = summarizeFileContext(part);
      expect(summaryPart.text).toBe('[CONTEXT] File: a/b.txt (/abs/a/b.txt)');
    });

    it('should return the original part if it is not a file context part', () => {
      const part: Part = { text: 'hello world' };
      const summaryPart = summarizeFileContext(part);
      expect(summaryPart).toBe(part);
    });
  });

  describe('summarizePartsFileContext', () => {
    it('should summarize multiple file context parts in an array', () => {
      const parts: Part[] = [
        { text: 'Here are files:' },
        createFileContextPart('a/b.txt', 'content1'),
        createFileContextPart('c/d.txt', 'content2', '/abs/c/d.txt'),
      ];
      const summarizedParts = summarizePartsFileContext(parts);
      expect(summarizedParts).toEqual([
        { text: 'Here are files:' },
        { text: '[CONTEXT] File: a/b.txt' },
        { text: '[CONTEXT] File: c/d.txt (/abs/c/d.txt)' },
      ]);
    });

    it('should return a new array with the same parts if no file context parts are present', () => {
      const parts: Part[] = [{ text: 'Hello' }, { text: 'World' }];
      const summarizedParts = summarizePartsFileContext(parts);
      // It should return a new array with the same parts.
      expect(summarizedParts).toEqual(parts);
      // But not the same array instance because of map.
      expect(summarizedParts).not.toBe(parts);
    });
  });

  describe('sanitizeUserContent', () => {
    it('should replace file content with a summary', () => {
      const userInput: Content = {
        role: 'user',
        parts: [
          { text: 'User input' },
          createFileContextPart(
            '/test/file.txt',
            'This is file content.',
            '/abs/test/file.txt',
          ),
        ],
      };

      const sanitized = sanitizeUserContent(userInput);
      expect(sanitized.parts).toEqual([
        { text: 'User input' },
        { text: '[CONTEXT] File: /test/file.txt (/abs/test/file.txt)' },
      ]);
    });

    it('should not alter content if no tracked files are present', () => {
      const userInput: Content = {
        role: 'user',
        parts: [{ text: 'A normal message' }],
      };
      const sanitized = sanitizeUserContent(userInput);
      expect(sanitized).toBe(userInput); // Should return original object
    });

    it('should handle multiple file contexts', () => {
      const userInput: Content = {
        role: 'user',
        parts: [
          { text: 'Here are two files' },
          createFileContextPart('file1.txt', 'content1'),
          createFileContextPart('file2.txt', 'content2', '/abs/file2.txt'),
        ],
      };
      const sanitized = sanitizeUserContent(userInput);
      expect(sanitized.parts).toEqual([
        { text: 'Here are two files' },
        { text: '[CONTEXT] File: file1.txt' },
        { text: '[CONTEXT] File: file2.txt (/abs/file2.txt)' },
      ]);
    });

    it('should handle content with no parts', () => {
      const userInput: Content = { role: 'user', parts: [] };
      const sanitized = sanitizeUserContent(userInput);
      expect(sanitized).toBe(userInput);
    });

    it('should handle content where parts is undefined', () => {
      const userInput: Content = { role: 'user', parts: undefined as any };
      const sanitized = sanitizeUserContent(userInput);
      expect(sanitized).toBe(userInput);
    });
  });
});
