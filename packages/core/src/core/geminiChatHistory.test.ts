/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Content } from '@google/genai';
import { GeminiChatHistory, RecentMessages } from './geminiChatHistory.js';
import { ContentGenerator } from './contentGenerator.js';

const mockContentGenerator = {
  countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
  generateContent: vi.fn(),
  embedContent: vi.fn(),
} as unknown as ContentGenerator;

describe('GeminiChatHistory', () => {
  let chatHistory: GeminiChatHistory;

  describe('constructor', () => {
    it('should initialize with an empty history by default', () => {
      chatHistory = new GeminiChatHistory(mockContentGenerator);
      expect(chatHistory.getHistory()).toEqual([]);
    });

    it('should initialize with the provided history', () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ];
      chatHistory = new GeminiChatHistory(mockContentGenerator, initialHistory);
      expect(chatHistory.getHistory()).toEqual(initialHistory);
    });

    it('should throw an error for invalid roles in initial history', () => {
      const invalidHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Valid' }] },
        { role: 'assistant', parts: [{ text: 'Invalid' }] },
      ];
      expect(
        () => new GeminiChatHistory(mockContentGenerator, invalidHistory),
      ).toThrow('Role must be user or model, but got assistant.');
    });
  });

  describe('addHistory and getHistory', () => {
    it('should add a new content item to the history', () => {
      chatHistory = new GeminiChatHistory(mockContentGenerator);
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
      chatHistory = new GeminiChatHistory(mockContentGenerator, initialHistory);
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
      chatHistory = new GeminiChatHistory(mockContentGenerator, initialHistory);
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
      chatHistory = new GeminiChatHistory(mockContentGenerator, initialHistory);
      chatHistory.setHistoryDangerous(newHistory);
      expect(chatHistory.getHistory()).toEqual(newHistory);
    });

    it('should throw an error if the new history has invalid roles', () => {
      const invalidHistory: Content[] = [
        { role: 'invalid', parts: [{ text: 'Invalid' }] },
      ];
      chatHistory = new GeminiChatHistory(mockContentGenerator);
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
      chatHistory = new GeminiChatHistory(mockContentGenerator);
    });

    it('should add user input and a single model output to history', async () => {
      const modelOutput: Content[] = [
        { role: 'model', parts: [{ text: 'Model output' }] },
      ];
      await chatHistory.addTurnResponse(userInput, modelOutput);
      const history = chatHistory.getHistory();
      expect(history).toEqual([userInput, modelOutput[0]]);
    });

    it('should consolidate adjacent model outputs', async () => {
      const modelOutputParts: Content[] = [
        { role: 'model', parts: [{ text: 'Model part 1' }] },
        { role: 'model', parts: [{ text: 'Model part 2' }] },
      ];
      await chatHistory.addTurnResponse(userInput, modelOutputParts);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]).toEqual(userInput);
      expect(history[1].role).toBe('model');
      expect(history[1].parts).toEqual([{ text: 'Model part 1Model part 2' }]);
    });

    it('should handle a mix of user and model roles in outputContents', async () => {
      const mixedOutput: Content[] = [
        { role: 'model', parts: [{ text: 'Model 1' }] },
        { role: 'user', parts: [{ text: 'Unexpected User' }] },
        { role: 'model', parts: [{ text: 'Model 2' }] },
      ];
      await chatHistory.addTurnResponse(userInput, mixedOutput);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(4);
      expect(history[0]).toEqual(userInput);
      expect(history[1]).toEqual(mixedOutput[0]);
      expect(history[2]).toEqual(mixedOutput[1]);
      expect(history[3]).toEqual(mixedOutput[2]);
    });

    it('should merge with last history entry if it is also a model output', async () => {
      const initialHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Initial User' }] },
        { role: 'model', parts: [{ text: 'Initial Model' }] },
      ];
      chatHistory.setHistoryDangerous(initialHistory);

      const newModelOutput: Content[] = [
        { role: 'model', parts: [{ text: 'New Model Part 1' }] },
      ];
      await chatHistory.addTurnResponse(userInput, newModelOutput);

      const finalHistory = chatHistory.getHistory();
      expect(finalHistory.length).toBe(4);
      expect(finalHistory[2]).toEqual(userInput);
      expect(finalHistory[3].parts).toEqual([{ text: 'New Model Part 1' }]);
    });

    it('should handle empty modelOutput array by adding a default empty model part', async () => {
      await chatHistory.addTurnResponse(userInput, []);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]).toEqual(userInput);
      expect(history[1]).toEqual({ role: 'model', parts: [] });
    });

    it('should correctly handle automaticFunctionCallingHistory', async () => {
      const afcHistory: Content[] = [
        { role: 'user', parts: [{ text: 'AFC User' }] },
        { role: 'model', parts: [{ text: 'AFC Model' }] },
      ];
      const modelOutput: Content[] = [
        { role: 'model', parts: [{ text: 'Regular Model Output' }] },
      ];
      await chatHistory.addTurnResponse(userInput, modelOutput, afcHistory);
      const history = chatHistory.getHistory();
      expect(history.length).toBe(3);
      expect(history[0]).toEqual(afcHistory[0]);
      expect(history[1]).toEqual(afcHistory[1]);
      expect(history[2]).toEqual(modelOutput[0]);
    });

    it('should skip "thought" content from modelOutput', async () => {
      const modelOutputWithThought: Content[] = [
        { role: 'model', parts: [{ thought: true }] },
        { role: 'model', parts: [{ text: 'Visible text' }] },
      ];
      await chatHistory.addTurnResponse(userInput, modelOutputWithThought);
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
      chatHistory = new GeminiChatHistory(
        mockContentGenerator,
        comprehensiveHistory,
      );
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
      chatHistory = new GeminiChatHistory(
        mockContentGenerator,
        comprehensiveHistory,
      );
      const curated = chatHistory.getHistory(true);
      expect(curated.length).toBe(3);
      // @ts-expect-error Might be undefined
      expect(curated[2].parts[0].text).toBe('User 2');
    });

    it('should return an empty array for empty comprehensive history', () => {
      chatHistory = new GeminiChatHistory(mockContentGenerator);
      const curated = chatHistory.getHistory(true);
      expect(curated).toEqual([]);
    });
  });

  describe('Large number of turns', () => {
    it('should handle more than 25 turns without error', async () => {
      const recentMessages = new RecentMessages(mockContentGenerator);
      const totalTurns = 40;
      const gch = new GeminiChatHistory(
        mockContentGenerator,
        recentMessages.messages,
      );

      const userContent: Content = {
        role: 'user',
        parts: [{ text: 'loruem-ipsum' }],
      };
      //placeholders
      gch.addHistoryDangerous(userContent);
      gch.addHistoryDangerous(userContent);

      // let's overflow due to raw message volume.
      for (let i = 0; i < totalTurns; i++) {
        const fcnCallContent: Content[] = [
          {
            role: 'model',
            parts: [{ functionCall: { name: 'loruem-ipsum' } }],
          },
        ];
        const fcnRespContent: Content[] = [
          {
            role: 'user',
            parts: [{ functionResponse: { name: 'loruem-ipsum' } }],
          },
        ];
        await gch.addTurnResponse(fcnCallContent[0], fcnRespContent);
      }

      // @ts-expect-error private message
      expect(gch.recentMessages.messages.length).toBe(82);
      // @ts-expect-error private message
      expect(gch.historicMessages.messages.length).toBe(0);
    });
  });

  describe('lots of messages, then a large one comes in', () => {
    it('should handle promoting previous messages to make room', async () => {
      const recentMessages = new RecentMessages(mockContentGenerator);
      const blockMsg =
        'Bacon ipsum dolor amet meatball pig burgdoggen alcatra bacon. Andouille jerky shankle flank landjaeger turkey. Venison picanha ham hock chislic ribeye, brisket beef. Pork picanha meatloaf, meatball tail boudin pork belly swine ribeye biltong landjaeger tongue pastrami hamburger fatback. Frankfurter beef ribs biltong pork chop rump porchetta. Tongue pork short loin kielbasa pork loin cupim picanha shoulder strip steak tenderloin kevin beef ribs hamburger. Chislic tongue cupim beef ribs biltong boudin prosciutto beef pancetta swine ham drumstick ball tip jerky. Sausage pork fatback shankle shoulder, ribeye kielbasa spare ribs bresaola filet mignon shank. Pork buffalo jowl venison, tenderloin turkey doner. Kielbasa pork loin chuck t-bone, swine kevin fatback chislic strip steak pig andouille frankfurter tail. Short ribs ham shoulder tri-tip buffalo drumstick bresaola. Chislic biltong corned beef meatloaf tenderloin flank, sirloin strip steak brisket pastrami. Shoulder pork belly chicken, pork landjaeger swine buffalo tongue. Sausage burgdoggen boudin filet mignon chicken shankle. Cupim buffalo pastrami, bresaola hamburger salami tail strip steak biltong ham bacon capicola jerky porchetta. Meatloaf tongue short loin ham turkey meatball shoulder strip steak rump picanha andouille buffalo. Fatback pork belly bresaola, t-bone kielbasa cupim shoulder tenderloin biltong brisket ribeye chuck. Cupim pork belly andouille, venison porchetta pig spare ribs. Beef ribs andouille jerky chuck corned beef ground round. Landjaeger flank shank leberkas sausage corned beef. Beef ribeye chicken corned beef turkey. Boudin burgdoggen flank sirloin tail prosciutto beef sausage alcatra leberkas ham hock picanha doner cow. Turducken prosciutto beef, buffalo pork biltong spare ribs swine short loin capicola. Ground round leberkas kevin turducken ribeye. Shank picanha tenderloin beef, prosciutto kevin brisket ham hock ribeye shankle corned beef. Ribeye porchetta strip steak, salami pork boudin chislic pork chop pork loin shank pork belly andouille flank bacon. Corned beef porchetta boudin spare ribs tongue ham hock doner drumstick strip steak fatback chuck beef leberkas t-bone. Pig salami corned beef venison tail prosciutto. Pork chop tongue corned beef, drumstick pork belly andouille sausage.';

      vi.spyOn(mockContentGenerator, 'countTokens').mockImplementation(
        async (req) => {
          const contents = req.contents as Content[];
          const text = contents
            .map((c) => c.parts?.map((p) => ('text' in p ? p.text : '')))
            .flat()
            .join('');
          return { totalTokens: text.length };
        },
      );

      const gch = new GeminiChatHistory(
        mockContentGenerator,
        recentMessages.messages,
      );

      const userContent: Content = {
        role: 'user',
        parts: [{ text: 'loruem-ipsum' }],
      };

      //placeholders
      gch.addHistoryDangerous(userContent);
      gch.addHistoryDangerous(userContent);

      //Put a bunch of messages in, give it a big message, see how it clears out space
      for (let i = 0; i < 80; i++) {
        const fcnCallContent: Content[] = [
          {
            role: 'model',
            parts: [{ functionCall: { name: 'loruem-ipsum' } }],
          },
        ];
        const fcnRespContent: Content[] = [
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'loruem-ipsum',
                  response: { output: blockMsg },
                },
              },
            ],
          },
        ];
        await gch.addTurnResponse(fcnCallContent[0], fcnRespContent);
      }

      const largeMessage = blockMsg.repeat(300);
      const fcnCallContent: Content[] = [
        { role: 'model', parts: [{ functionCall: { name: 'loruem-ipsum' } }] },
      ];
      const fcnRespContent: Content[] = [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'loruem-ipsum',
                response: { output: largeMessage },
              },
            },
          ],
        },
      ];
      await gch.addTurnResponse(fcnCallContent[0], fcnRespContent);

      console.log(
        'rct',
        // @ts-expect-error private message
        gch.recentMessages.messages.length,
        'hst',
        // @ts-expect-error private message
        gch.historicMessages.messages.length,
      );

      // @ts-expect-error private message
      expect(gch.recentMessages.messages.length).toBe(164);
      // @ts-expect-error private message
      expect(gch.historicMessages.messages.length).toBe(0);
    });
  });
});
