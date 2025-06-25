/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Content } from '@google/genai';
import { GeminiChatHistory } from './geminiChatHistory.js';

describe('GeminiChatHistory', () => {
  let chatHistory: GeminiChatHistory;

  describe('constructor', () => {
    it('should initialize with an empty history by default', () => {
      chatHistory = new GeminiChatHistory();
      expect(chatHistory.getHistory()).toEqual([]);
    });

    it('should initialize with the provided history', () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ];
      chatHistory = new GeminiChatHistory(initialHistory);
      expect(chatHistory.getHistory()).toEqual(initialHistory);
    });

    it('should throw an error for invalid roles in initial history', () => {
      const invalidHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Valid' }] },
        { role: 'assistant', parts: [{ text: 'Invalid' }] },
      ];
      expect(() => new GeminiChatHistory(invalidHistory)).toThrow(
        'Role must be user or model, but got assistant.',
      );
    });
  });

  describe('addHistory and getHistory', () => {
    it('should add a new content item to the history', () => {
      chatHistory = new GeminiChatHistory();
      const newContent: Content = {
        role: 'user',
        parts: [{ text: 'A new message' }],
      };
      chatHistory.addHistoryDangerous(newContent);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toEqual(newContent);
    });

    it('should return a deep copy of the history', () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Original' }] },
      ];
      chatHistory = new GeminiChatHistory(initialHistory);
      const historyCopy = chatHistory.getHistory();
      // @ts-expect-error Might be undefined
      historyCopy[0].parts[0].text = 'Modified';
      // @ts-expect-error Might be undefined
      expect(chatHistory.getHistory()[0].parts[0].text).toBe('Original');
    });
  });

  describe('clearHistory', () => {
    it('should clear all items from the history', () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Message 1' }] },
        { role: 'model', parts: [{ text: 'Message 2' }] },
      ];
      chatHistory = new GeminiChatHistory(initialHistory);
      chatHistory.clearHistory();
      expect(chatHistory.getHistory()).toEqual([]);
    });
  });

  describe('setHistory', () => {
    it('should replace the existing history with a new one', () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Initial' }] },
      ];
      const newHistory: Content[] = [
        { role: 'user', parts: [{ text: 'New 1' }] },
        { role: 'model', parts: [{ text: 'New 2' }] },
      ];
      chatHistory = new GeminiChatHistory(initialHistory);
      chatHistory.setHistoryDangerous(newHistory);
      expect(chatHistory.getHistory()).toEqual(newHistory);
    });

    it('should throw an error if the new history has invalid roles', () => {
      const invalidHistory: Content[] = [
        { role: 'invalid', parts: [{ text: 'Invalid' }] },
      ];
      chatHistory = new GeminiChatHistory();
      expect(() => chatHistory.setHistoryDangerous(invalidHistory)).toThrow(
        'Role must be user or model, but got invalid.',
      );
    });
  });

  describe('addTurnResponse', () => {
    const userInput: Content = {
      role: 'user',
      parts: [{ text: 'User input' }],
    };

    beforeEach(() => {
      chatHistory = new GeminiChatHistory();
    });

    it('should add user input and a single model output to history', () => {
      const modelOutput: Content[] = [
        { role: 'model', parts: [{ text: 'Model output' }] },
      ];
      chatHistory.addTurnResponse(userInput, modelOutput);
      const history = chatHistory.getHistory();
      expect(history).toEqual([userInput, modelOutput[0]]);
    });

    it('should consolidate adjacent model outputs', () => {
      const modelOutputParts: Content[] = [
        { role: 'model', parts: [{ text: 'Model part 1' }] },
        { role: 'model', parts: [{ text: 'Model part 2' }] },
      ];
      chatHistory.addTurnResponse(userInput, modelOutputParts);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]).toEqual(userInput);
      expect(history[1].role).toBe('model');
      expect(history[1].parts).toEqual([{ text: 'Model part 1Model part 2' }]);
    });

    it('should handle a mix of user and model roles in outputContents', () => {
      const mixedOutput: Content[] = [
        { role: 'model', parts: [{ text: 'Model 1' }] },
        { role: 'user', parts: [{ text: 'Unexpected User' }] },
        { role: 'model', parts: [{ text: 'Model 2' }] },
      ];
      chatHistory.addTurnResponse(userInput, mixedOutput);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(4);
      expect(history[0]).toEqual(userInput);
      expect(history[1]).toEqual(mixedOutput[0]);
      expect(history[2]).toEqual(mixedOutput[1]);
      expect(history[3]).toEqual(mixedOutput[2]);
    });

    it('should merge with last history entry if it is also a model output', () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Initial User' }] },
        { role: 'model', parts: [{ text: 'Initial Model' }] },
      ];
      chatHistory.setHistoryDangerous(initialHistory);

      const newModelOutput: Content[] = [
        { role: 'model', parts: [{ text: 'New Model Part 1' }] },
      ];
      chatHistory.addTurnResponse(userInput, newModelOutput);

      const finalHistory = chatHistory.getHistory();
      expect(finalHistory.length).toBe(4);
      expect(finalHistory[2]).toEqual(userInput);
      expect(finalHistory[3].parts).toEqual([{ text: 'New Model Part 1' }]);
    });

    it('should handle empty modelOutput array by adding a default empty model part', () => {
      chatHistory.addTurnResponse(userInput, []);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]).toEqual(userInput);
      expect(history[1]).toEqual({ role: 'model', parts: [] });
    });

    it('should correctly handle automaticFunctionCallingHistory', () => {
      const afcHistory: Content[] = [
        { role: 'user', parts: [{ text: 'AFC User' }] },
        { role: 'model', parts: [{ text: 'AFC Model' }] },
      ];
      const modelOutput: Content[] = [
        { role: 'model', parts: [{ text: 'Regular Model Output' }] },
      ];
      chatHistory.addTurnResponse(userInput, modelOutput, afcHistory);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(3);
      expect(history[0]).toEqual(afcHistory[0]);
      expect(history[1]).toEqual(afcHistory[1]);
      expect(history[2]).toEqual(modelOutput[0]);
    });

    it('should skip "thought" content from modelOutput', () => {
      const modelOutputWithThought: Content[] = [
        { role: 'model', parts: [{ thought: true }] },
        { role: 'model', parts: [{ text: 'Visible text' }] },
      ];
      chatHistory.addTurnResponse(userInput, modelOutputWithThought);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(2);
      expect(history[1].parts).toEqual([{ text: 'Visible text' }]);
    });
  });

  describe('getHistory with curated=true', () => {
    it('should return only valid and complete turns', () => {
      const comprehensiveHistory: Content[] = [
        { role: 'user', parts: [{ text: 'User 1' }] },
        { role: 'model', parts: [{ text: 'Model 1' }] },
        { role: 'user', parts: [{ text: 'User 2' }] },
        { role: 'model', parts: [] }, // Invalid model response
      ];
      chatHistory = new GeminiChatHistory(comprehensiveHistory);
      const curated = chatHistory.getHistory(true);
      expect(curated.length).toBe(2);
      // @ts-expect-error Might be undefined
      expect(curated[0].parts[0].text).toBe('User 1');
      // @ts-expect-error Might be undefined
      expect(curated[1].parts[0].text).toBe('Model 1');
    });

    it('should handle history ending with a user turn', () => {
      const comprehensiveHistory: Content[] = [
        { role: 'user', parts: [{ text: 'User 1' }] },
        { role: 'model', parts: [{ text: 'Model 1' }] },
        { role: 'user', parts: [{ text: 'User 2' }] },
      ];
      chatHistory = new GeminiChatHistory(comprehensiveHistory);
      const curated = chatHistory.getHistory(true);
      expect(curated.length).toBe(3);
      // @ts-expect-error Might be undefined
      expect(curated[2].parts[0].text).toBe('User 2');
    });

    it('should return an empty array for empty comprehensive history', () => {
      chatHistory = new GeminiChatHistory();
      const curated = chatHistory.getHistory(true);
      expect(curated).toEqual([]);
    });
  });

  describe('Large number of turns', () => {
    it('should handle more than 25 turns without error', () => {
      chatHistory = new GeminiChatHistory();
      const totalTurns = 30;

      for (let i = 0; i < totalTurns; i++) {
        const userInput: Content = {
          role: 'user',
          parts: [{ text: `User input ${i}` }],
        };
        const modelOutput: Content[] = [
          { role: 'model', parts: [{ text: `Model output ${i}` }] },
        ];
        chatHistory.addTurnResponse(userInput, modelOutput);
      }

      const history = chatHistory.getHistory();
      const recentMessages = chatHistory['recentMessages'].messages;
      const historicMessages = chatHistory['historicMessages'].messages;

      // 50 total messages, 25 historic, 25 recent
      expect(history.length).toBe(50);
      expect(recentMessages.length).toBe(25);
      expect(historicMessages.length).toBe(25);

      // check the first historic message
      const firstHistoricMessage = historicMessages[0];
      expect(firstHistoricMessage.role).toBe('user');
      // @ts-expect-error - parts might be undefined
      expect(firstHistoricMessage.parts[0].text).toBe('User input 5');

      // check the last recent message
      const lastRecentMessage = recentMessages[recentMessages.length - 1];
      expect(lastRecentMessage.role).toBe('model');
      // @ts-expect-error - parts might be undefined
      expect(lastRecentMessage.parts[0].text).toBe('Model output 29');
    });
  });
});
