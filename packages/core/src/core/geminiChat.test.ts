/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Content,
  Models,
  GenerateContentConfig,
  GenerateContentResponse,
} from '@google/genai';
import { GeminiChat } from './geminiChat.js';
import { Config } from '../config/config.js';
import { setSimulate429 } from '../utils/testUtils.js';

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
  getTelemetryLogPromptsEnabled: () => true,
  getUsageStatisticsEnabled: () => true,
  getDebugMode: () => false,
  getContentGeneratorConfig: () => ({
    authType: 'oauth-personal',
    model: 'test-model',
  }),
  setModel: vi.fn(),
  flashFallbackHandler: undefined,
} as unknown as Config;

describe('GeminiChat', () => {
  let chat: GeminiChat;
  const model = 'gemini-pro';
  const config: GenerateContentConfig = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Disable 429 simulation for tests
    setSimulate429(false);
    // Reset history for each test by creating a new instance
    chat = new GeminiChat(mockConfig, mockModelsModule, model, config, []);
    const mockGenerator: Partial<ContentGenerator> = {
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      generateContent: vi.fn().mockResolvedValue({
        usageMetadata: {
          totalTokens: 1,
        },
      }),
      generateContentStream: vi.fn().mockResolvedValue((async function* () {})()),
    };
    chat['contentGenerator'] = mockGenerator as ContentGenerator;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendMessage', () => {
    it('should call generateContent with the correct parameters', async () => {
      await chat.sendMessage({ message: 'hello' });

      expect(
        (chat['contentGenerator'] as ContentGenerator).generateContent,
      ).toHaveBeenCalledWith({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        config: {},
      });
    });
  });

  describe('sendMessageStream', () => {
    it('should call generateContentStream with the correct parameters', async () => {
      await chat.sendMessageStream({ message: 'hello' });

      expect(
        (chat['contentGenerator'] as ContentGenerator).generateContentStream,
      ).toHaveBeenCalledWith({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        config: {},
      });
    });
  });

  describe('addHistory', () => {
    it('should add a new content item to the history', async () => {
      const newContent: Content = {
        role: 'user',
        parts: [{ text: 'A new message' }],
      };
      await chat.addHistory(newContent);
      const history = chat.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toEqual(newContent);
    });

    it('should add multiple items correctly', async () => {
      const content1: Content = {
        role: 'user',
        parts: [{ text: 'Message 1' }],
      };
      const content2: Content = {
        role: 'model',
        parts: [{ text: 'Message 2' }],
      };
      await chat.addHistory(content1);
      await chat.addHistory(content2);
      const history = chat.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]).toEqual(content1);
      expect(history[1]).toEqual(content2);
    });
  });
});
