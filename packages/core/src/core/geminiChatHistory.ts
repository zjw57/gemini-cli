/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, Part } from '@google/genai';
import { isFunctionResponse } from '../utils/messageInspectors.js';

/**
 * Checks if the given content represents a function call.
 * @param content The content to check.
 * @returns True if the content is a function call, false otherwise.
 */
function isFunctionCall(content: Content): boolean {
  return (
    content.role === 'model' &&
    !!content.parts &&
    content.parts.every((part) => !!part.functionCall)
  );
}

/**
 * Checks if the given content is valid.
 * @param content The content to check.
 * @returns True if the content is valid, false otherwise.
 */
function isValidContent(content: Content): boolean {
  if (content.parts === undefined || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === undefined || Object.keys(part).length === 0) {
      return false;
    }
    if (!part.thought && part.text !== undefined && part.text === '') {
      return false;
    }
  }
  return true;
}

/**
 * Checks if the given content is a user message content.
 * @param content The content to check.
 * @returns True if the content is a user message content, false otherwise.
 */
function isUserMessageContent(
  content: Content | undefined,
): content is Content & { parts: [{ text: string }, ...Part[]] } {
  return !!(
    content &&
    content.role === 'user' &&
    content.parts &&
    content.parts.length > 0 &&
    typeof content.parts[0].text === 'string' &&
    content.parts[0].text !== ''
  );
}

/**
 * Checks if the given content is text content.
 * @param content The content to check.
 * @returns True if the content is text content, false otherwise.
 */
function isTextContent(
  content: Content | undefined,
): content is Content & { parts: [{ text: string }, ...Part[]] } {
  return !!(
    content &&
    content.role === 'model' &&
    content.parts &&
    content.parts.length > 0 &&
    typeof content.parts[0].text === 'string' &&
    content.parts[0].text !== ''
  );
}

/**
 * Extracts the text content from a given Content object.
 * @param content The content object to extract text from.
 * @returns The text content if available, otherwise an empty string.
 */
function _getTextContent(content: Content | undefined): string {
  if (
    content &&
    content.role === 'model' &&
    content.parts &&
    content.parts.length > 0 &&
    typeof content.parts[0].text === 'string' &&
    content.parts[0].text !== ''
  ) {
    return content.parts[0].text;
  }
  return '';
}

/**
 * Checks if the given content is thought content.
 * @param content The content to check.
 * @returns True if the content is thought content, false otherwise.
 */
function isThoughtContent(
  content: Content | undefined,
): content is Content & { parts: [{ thought: boolean }, ...Part[]] } {
  return !!(
    content &&
    content.role === 'model' &&
    content.parts &&
    content.parts.length > 0 &&
    typeof content.parts[0].thought === 'boolean' &&
    content.parts[0].thought === true
  );
}

export class RecentMessages {
  /**
   * The array of messages currently stored in this history.
   */
  messages: Content[] = [];
  /**
   * The maximum number of messages to store in this history.
   */
  readonly maxSize: number = 25;

  /**
   * Initializes a new instance of the RecentMessages class.
   */
  constructor() {}

  /**
   * Returns the number of messages currently stored in the history.
   * @returns The number of messages.
   */
  numMessages() {
    return this.messages.length;
  }

  /**
   * Clears all the history messages
   */
  clearHistory(): void {
    this.messages = [];
  }

  /**
   * Manually pushes a message into the history. This function is marked 'dangerous'
   * as manual manipulation of the message queue risks inserting errors due to the
   * GenerateContent API's requirements regarding message interleaving for function calling.
   * Users of this function are responsible for adhering to those requirements.
   * @param content The content to add to the history.
   */
  addHistoryDangerous(content: Content): void {
    this.messages.push(content);
  }

  /**
   * Manually sets the entire message history. This function is marked 'dangerous'
   * as manual manipulation of the message queue risks inserting errors due to the
   * GenerateContent API's requirements regarding message interleaving for function calling.
   * Users of this function are responsible for adhering to those requirements.
   * @param history The array of Content objects to set as the history.
   */
  setHistoryDangerous(history: Content[]): void {
    this.validateHistory(history);
    this.messages = history;
  }

  /**
   * Retrieves the messages from the history.
   * @param curated - If true, returns a curated history (valid turns only). If false, returns the full message history.
   * @returns An array of Content objects representing the message history.
   */
  getMessages(curated: boolean): Content[] {
    if (curated) return this.extractCuratedHistory(this.messages);
    return this.messages;
  }
  /**
   * Validates the history contains the correct roles.
   *
   * @throws Error if the history does not start with a user turn.
   * @throws Error if the history contains an invalid role.
   */
  private validateHistory(history: Content[]) {
    // Empty history is valid.
    if (history.length === 0) {
      return;
    }
    for (const content of history) {
      if (content.role !== 'user' && content.role !== 'model') {
        throw new Error(`Role must be user or model, but got ${content.role}.`);
      }
    }
  }

  /**
   * Extracts the curated (valid) history from a comprehensive history.
   *
   * @remarks
   * The model may sometimes generate invalid or empty contents(e.g., due to safty
   * filters or recitation). Extracting valid turns from the history
   * ensures that subsequent requests could be accpeted by the model.
   */
  private extractCuratedHistory(comprehensiveHistory: Content[]): Content[] {
    if (
      comprehensiveHistory === undefined ||
      comprehensiveHistory.length === 0
    ) {
      return [];
    }
    const curatedHistory: Content[] = [];
    const length = comprehensiveHistory.length;
    let i = 0;

    /*
      The expectation here is that the message history is a series of user/model response pairs
      where the user message is followed by N model messages
      If any of the model messages are invalid, then it invalidates the whole block of model responses, 
      and we can ignore not only those messages, but the user message that preceeded it as well. 
    */

    while (i < length) {
      // always keep user messages (from the actual user, or tool responses)
      if (comprehensiveHistory[i].role === 'user') {
        curatedHistory.push(comprehensiveHistory[i]);
        i++;
        continue;
      }

      // check model response block for validity - if any message is invalid, the whole span is.
      const modelOutput: Content[] = [];
      let isValid = true;
      while (i < length && comprehensiveHistory[i].role === 'model') {
        modelOutput.push(comprehensiveHistory[i]);
        if (isValid && !isValidContent(comprehensiveHistory[i])) {
          isValid = false;
        }
        i++;
      }

      if (isValid) {
        curatedHistory.push(...modelOutput);
      } else {
        // Remove the last user input when model content is invalid.
        curatedHistory.pop();
      }
    }

    return curatedHistory;
  }

  /**
   * Given the input to the model, and the output from the model, process the output
   * and smartly store it into our history to take into account certain conditions
   * that keep our message history clean.
   * @param userInput The content of the user's input.
   * @param modelOutput An array of content from the model's output.
   * @param automaticFunctionCallingHistory Optional history from automatic function calling.
   */
  addTurnResponse(
    userInput: Content,
    modelOutput: Content[],
    automaticFunctionCallingHistory?: Content[],
  ) {
    // filter out 'thought' content - we're only interested in non-thought content.
    const nonThoughtModelOutput = modelOutput.filter(
      (content) => !isThoughtContent(content),
    );

    let outputContents: Content[] = [];
    if (
      nonThoughtModelOutput.length > 0 &&
      nonThoughtModelOutput.every((content) => content.role !== undefined)
    ) {
      outputContents = nonThoughtModelOutput;
    } else if (nonThoughtModelOutput.length === 0 && modelOutput.length > 0) {
      // This case handles when the model returns only a thought.
      // We don't want to add an empty model response in this case.
    } else {
      // When not a function response appends an empty content when model returns empty response, so that the
      // history is always alternating between user and model.
      // Workaround for: https://b.corp.google.com/issues/420354090
      if (!isFunctionResponse(userInput)) {
        outputContents.push({
          role: 'model',
          parts: [],
        } as Content);
      }
    }

    // Automatic function calling can be handled seperatly from thought content.
    if (
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    ) {
      this.messages.push(
        ...this.extractCuratedHistory(automaticFunctionCallingHistory!),
      );
    } else {
      this.messages.push(userInput);
    }

    // Consolidate adjacent model roles in outputContents
    const consolidatedOutputContents: Content[] = [];
    for (const content of outputContents) {
      if (isThoughtContent(content)) {
        continue;
      }
      const lastContent =
        consolidatedOutputContents[consolidatedOutputContents.length - 1];
      if (isTextContent(lastContent) && isTextContent(content)) {
        // If both current and last are text, combine their text into the lastContent's first part
        // and append any other parts from the current content.
        lastContent.parts[0].text += content.parts[0].text || '';
        if (content.parts.length > 1) {
          lastContent.parts.push(...content.parts.slice(1));
        }
      } else {
        consolidatedOutputContents.push(content);
      }
    }

    if (consolidatedOutputContents.length > 0) {
      const lastHistoryEntry = this.messages[this.messages.length - 1];
      const canMergeWithLastHistory =
        !automaticFunctionCallingHistory ||
        automaticFunctionCallingHistory.length === 0;

      if (
        canMergeWithLastHistory &&
        isTextContent(lastHistoryEntry) &&
        isTextContent(consolidatedOutputContents[0])
      ) {
        // If both current and last are text, combine their text into the lastHistoryEntry's first part
        // and append any other parts from the current content.
        lastHistoryEntry.parts[0].text +=
          consolidatedOutputContents[0].parts[0].text || '';
        if (consolidatedOutputContents[0].parts.length > 1) {
          lastHistoryEntry.parts.push(
            ...consolidatedOutputContents[0].parts.slice(1),
          );
        }
        consolidatedOutputContents.shift(); // Remove the first element as it's merged
      }
      // finally, add our message
      this.messages.push(...consolidatedOutputContents);
    }
  }
}

export class HistoricMessages {
  /**
   * The array of messages currently stored in this history.
   */
  messages: Content[] = [];
  /**
   * The maximum number of messages to store in this history.
   */
  readonly maxSize: number = 25;

  /**
   * Initializes a new instance of the HistoricMessages class.
   */
  constructor() {}

  /**
   * Returns the number of messages currently stored in the history.
   * @returns The number of messages.
   */
  numMessages() {
    return this.messages.length;
  }

  /**
   * Clears all the history messages
   */
  clearHistory(): void {
    this.messages = [];
  }

  /**
   * Adds only select messages to our history, pruning invalid or uninteresting ones.
   * @param msgs The messages to add.
   */
  addMessages(msgs: Content[]) {
    if (!msgs.length) return;

    // we expect that the msg block will be a valid fcnCall->fcnResp path,
    // so we should prune the block, not the single messages (otherwise genAI API will throw an error)

    const toolNamesToIgnore = [
      'list_directory',
      'read_file',
      'glob',
      'search_file_content',
    ];

    // let's work in chunks of fcnCall->fcnResponse blocks
    const spans = this.parseSpans(msgs);
    for (const s of spans) {
      //if the function call is a filterable one, then get rid of the call, and the responses.
      const callParts = s.call.parts;
      if (!callParts) {
        continue;
      }

      const fcncallName = callParts[0].functionCall?.name;

      // if there's no name, or the name is in the 'intentional ignore' group, then continue
      if (!fcncallName || toolNamesToIgnore.includes(fcncallName)) {
        continue;
      }

      //if any of the function responses include the word "Error", then let's assume the whole block was a bust, and prune it
      let isNotErrorResp = true;
      const resp = s.resp;
      for (const rs of resp) {
        if (rs.parts === undefined) {
          continue;
        }

        for (const rsp of rs.parts) {
          if (rsp.text && rsp.text.includes('Error')) {
            isNotErrorResp = false;
            break;
          }
        }
      }

      if (!isNotErrorResp) {
        continue;
      }

      this.messages.push(s.call);
      for (const sr of s.resp) this.messages.push(sr);
    }

    // Some of these messages may be related to long-term goals
    // We shouldn't delete them, so much as summarize them?
    while (this.messages.length > this.maxSize) {
      this.messages.shift();
    }
  }

  /**
   * Parses the content into spans of function calls and their responses.
   * @param content The content array to parse.
   * @returns An array of objects, each containing a 'call' (Content) and 'resp' (Content[]) for function call spans.
   */
  private parseSpans(content: Content[]) {
    // we're assuming this is a valid block, and don't need to call the validator check..
    const spans = [];
    // let's find any functioncall blocks, and then ensure there's a correct amount of functionresponse blocks trailing it.
    for (let i = 0; i < content.length; i++) {
      const tgtContent = content[i];
      if (isFunctionCall(tgtContent)) {
        const spanResp: Content[] = [];
        // how many function calls?
        let numCalls = 0;
        tgtContent?.parts?.every((_part) => {
          numCalls++;
        });

        // scan ahead and make sure there's exactly that number of function responses
        for (let j = 0; j < numCalls; j++) {
          const ij = i + 1 + j;
          spanResp.push(content[ij]);
        }

        // skip ahead
        i += numCalls;
        spans.push({ call: tgtContent, resp: spanResp });
      }
    }
    return spans;
  }
}
/**
 * Manages the chat session history for the Gemini model, handling message storage,
 * retrieval, and pruning to maintain context while adhering to the GenerateContent API's
 * strict requirements for message ordering, especially concerning function calls and responses.
 *
 * Functions marked 'dangerous' allow direct manipulation of the message queue,
 * which can lead to API errors if not used carefully. Users are responsible for
 * ensuring adherence to GenerateContent API requirements when using these functions.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 */
export class GeminiChatHistory {
  /**
   * Stores messages that are always kept at the front of the history.
   */
  private pinnedMessages: Content[];
  /**
   * Full context messages, managed by the RecentMessages class.
   */
  private recentMessages: RecentMessages = new RecentMessages();
  /**
   * Pruned and trimmed messages, managed by the HistoricMessages class.
   */
  private historicMessages: HistoricMessages = new HistoricMessages();
  /**
   * The maximum number of historic messages to store.
   */
  private readonly numHistoricMessages: number = 25;

  /**
   * Initializes a new instance of the GeminiChatHistory class.
   * @param history Optional initial history to set. Defaults to an empty array.
   */
  constructor(history: Content[] = []) {
    this.setHistoryDangerous(history);
    this.pinnedMessages = [];
  }

  /**
   * Adds messages to the pinned messages history. These messages will always be at the front of the history.
   * @param msgs The array of Content objects to add as pinned messages.
   */
  addPinnedMessages(msgs: Content[]) {
    this.pinnedMessages.push(...msgs);
  }
  /**
   * Retrieves the message history.
   * @param curated - Optional. If true, returns a curated history (valid turns only). Defaults to false.
   * @returns An array of Content objects representing the message history.
   */
  getHistory(curated = false): Content[] {
    const recent = this.recentMessages.getMessages(curated);
    const histroic = this.historicMessages.messages;

    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone([...this.pinnedMessages, ...histroic, ...recent]);
  }

  /**
   * Clears all the history messages
   */
  clearHistory(): void {
    this.pinnedMessages = [];
    this.recentMessages.clearHistory();
    this.historicMessages.clearHistory();
  }

  /**
   * Manually pushes a message into the history. This function is marked 'dangerous'
   * as manual manipulation of the message queue risks inserting errors due to the
   * GenerateContent API's requirements regarding message interleaving for function calling.
   * Users of this function are responsible for adhering to those requirements.
   * @param content The content to add to the history.
   */
  addHistoryDangerous(content: Content): void {
    this.recentMessages.addHistoryDangerous(content);
    this.processMessageGenerations();
  }

  /**
   * Manually set all of the history. This is named 'dangerous' due to the same reasons as `addHistoryDangerous`.
   * @param history The array of Content objects to set as the history.
   */
  setHistoryDangerous(history: Content[]): void {
    this.recentMessages.setHistoryDangerous(history);
    this.processMessageGenerations();
  }

  /**
   * Given the input to the model, and the output from the model, process the output
   * and smartly store it into our history to take into account certain conditions
   * that keep our message history clean.
   * @param userInput The content of the user's input.
   * @param modelOutput An array of content from the model's output.
   * @param automaticFunctionCallingHistory Optional history from automatic function calling.
   */
  addTurnResponse(
    userInput: Content,
    modelOutput: Content[],
    automaticFunctionCallingHistory?: Content[],
  ) {
    this.recentMessages.addTurnResponse(
      userInput,
      modelOutput,
      automaticFunctionCallingHistory,
    );
    this.processMessageGenerations();
  }

  /**
   * Processes messages to manage history size, moving older messages to historicMessages
   * if the recentMessages buffer exceeds its maximum size. It also handles special
   * preamble messages (like initial context or "Get Started!" messages) by temporarily
   * holding them and re-inserting them at the front of the recentMessages after processing.
   */
  private processMessageGenerations(): void {
    // only trigger when we're above the maxsize
    if (this.recentMessages.messages.length < this.recentMessages.maxSize)
      return;

    function testPreambleContent(
      tgtContent: Content | undefined,
      tgtStr: string,
    ) {
      /**
       * Tests if the target content is a user message and includes a specific string.
       *
       * @param tgtContent The content to test.
       * @param tgtStr The string to search for within the content's text.
       * @returns True if the content is a user message and contains the string, false otherwise.
       */
      if (
        tgtContent &&
        tgtContent.role === 'user' &&
        tgtContent.parts &&
        tgtContent.parts.length > 0 &&
        typeof tgtContent.parts[0].text === 'string' &&
        tgtContent.parts[0].text !== '' &&
        tgtContent.parts[0].text.includes(tgtStr)
      )
        return true;
      return false;
    }

    // check if the system message is the first message (happens sometimes..)
    let systemHolders: Array<Content | undefined> = [];

    //from the getEnv call, we start with these two messages
    if (
      testPreambleContent(
        this.recentMessages.messages[0],
        'Okay, just setting up the context for our chat.',
      )
    ) {
      systemHolders.push(this.recentMessages.messages.shift()); // here's context
      systemHolders.push(this.recentMessages.messages.shift()); //Got it. Thanks for the context!
    }
    // if it's a subagent, there will be a "get started" message
    if (testPreambleContent(this.recentMessages.messages[0], 'Get Started!')) {
      systemHolders.push(this.recentMessages.messages.shift()); //get started
    }

    // Let's eat as many call/response spans as we can, until we're under the limit
    // this might eat into the main buffer a bit.. that's fine.
    const overflow: Content[] = [];
    while (this.recentMessages.messages.length > this.recentMessages.maxSize) {
      const tgtContent = this.recentMessages.messages[0];
      if (isFunctionCall(tgtContent)) {
        // If it's a function call from the model down to the client
        overflow.push(this.recentMessages.messages.shift()!);

        const _spanResp: Content[] = [];
        // how many function calls should we expect from the client in response?
        let numCalls = 0;
        tgtContent?.parts?.every((_part) => {
          numCalls++;
        });

        // push each of the blocks
        for (let j = 0; j < numCalls; j++) {
          overflow.push(this.recentMessages.messages.shift()!);
        }
      } else if (isUserMessageContent(tgtContent)) {
        // if it's a user message from the client, we should then expect a function call response
        // Always add the user messages
        overflow.push(this.recentMessages.messages.shift()!);
      } else if (isTextContent(tgtContent)) {
        // Sometimes, some top-level messages from the model back to the user get into the stream, that haven't been filtered elsewhere
        // let's ignore those for now...
        continue;
      } else {
        console.error(
          'Found diff top level message',
          JSON.stringify(tgtContent),
        );
        break;
      }
    }

    // put the preambles back on the front.
    if (systemHolders.length) {
      while (systemHolders.length) {
        const c = systemHolders.pop();
        if (c) this.recentMessages.messages.unshift(c);
      }
      systemHolders = [];
    }

    // if we don't have overflow, continue
    if (!overflow.length) return;

    //console.log(`---->> we have ${overflow.length} overflow messages`)

    this.historicMessages.addMessages(overflow);
  }
}
