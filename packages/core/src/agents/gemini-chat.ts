/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDefinition } from './types.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { z } from 'zod';
import { WebFetchTool } from '../tools/web-fetch.js';

const GeminiChatResponseSchema = z.object({
  response: z.string().describe('The final chat response as a direct string.'),
});

/**
 * An agent that mimics the behavior of a Gemini chat session, specialized
 * for software engineering questions. It's designed to be used as a tool by
 * other agents for code-related queries, architectural discussions, or
 * debugging help.
 */
export const GeminiChatAgent: AgentDefinition<typeof GeminiChatResponseSchema> =
  {
    name: 'gemini_chat',
    displayName: 'Gemini Chat Agent',
    description: `A lightweight conversational AI tool that's an expert in software engineering. 
    Use this for code-related questions, architectural patterns, debugging, or any software development topic. 
    Use this AI tool to ask Gemini to implement code for you. It does not make changes to files, but it can output the desired code.
    It's your go-to tool when you need to "ask a senior engineer" something.
    This tool is stateless, so it does not have memory or history from previous chats or invocations.
    This tool does not have access to the codebase. So pass as much context as possible in your query.`,
    inputConfig: {
      inputs: {
        query: {
          description: `The user's question or prompt for the agent. 
          You MUST include as much context as possible, including relevant code snippets or even entire files, as this tool does not have access to the codebase.`,
          type: 'string',
          required: true,
        },
      },
    },
    outputConfig: {
      outputName: 'response_text',
      description: 'The final chat response as a direct string.',
      schema: GeminiChatResponseSchema,
    },

    processOutput: (output) => output.response,

    modelConfig: {
      model: DEFAULT_GEMINI_MODEL,
      // A lower temperature for more predictable, code-focused answers.
      temp: 0.3,
      top_p: 0.9,
      thinkingBudget: -1,
    },

    // No time or turn limits for a more open-ended chat experience.
    runConfig: {
      max_time_minutes: 5,
      max_turns: 5,
    },

    // This agent has no access to file system or other advanced tools by default.
    toolConfig: {
      tools: [WebFetchTool.name],
    },

    promptConfig: {
      // The query template simply passes the user's input directly.
      query: `\${query}`,
      // The system prompt defines the agent's persona and core instructions.
      systemPrompt: `You are a specialized software engineering AI assistant. Your only purpose is to answer the user's query directly and technically.

**CRITICAL INSTRUCTIONS:**
1.  You **MUST** answer the user's query by calling the \`complete_task\` tool.
2.  The 'response' parameter of the \`complete_task\` tool is the only thing the user will see.
3.  Your response should be a direct, expert-level answer. Do not include any conversational fluff, apologies, or explanations about your limitations.
4.  Use Markdown for code blocks and formatting.
5.  If you cannot answer, call \`complete_task\` with a helpful message explaining why.

You have one job: answer the query and call \`complete_task\`. Nothing else.
`,
    },
  };
