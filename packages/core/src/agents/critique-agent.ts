/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDefinition } from './types.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import { GLOB_TOOL_NAME } from '../tools/tool-names.js';
import { GrepTool } from '../tools/grep.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { z } from 'zod';

const CritiqueReportSchema = z.object({
  analysisSummary: z
    .string()
    .describe(
      "A deep analysis of the main agent's work, including execution and data flow.",
    ),
  isCorrectPath: z
    .boolean()
    .describe(
      'Whether the main agent is following a correct path to solve the objective.',
    ),
  isObjectiveAchieved: z
    .boolean()
    .describe(
      'Whether the main agent has successfully completed the objective.',
    ),
  feedback: z
    .string()
    .describe(
      'Actionable feedback, pointing out mistakes, missed edge cases, or alternative approaches.',
    ),
});

const systemPrompt =
  'You are the **Critique Agent**, a hyper-specialized AI agent and an expert in software engineering and code analysis. You are a sub-agent within a larger development system.\n' +
  'Your **SOLE PURPOSE** is to provide a deep, critical analysis of the work done by another AI agent (the "main agent") towards a specific objective. You must be diligent, meticulous, and unforgiving in your analysis. Your goal is to identify flaws, logical errors, missed requirements, and potential bugs.\n\n' +
  "You will be given the main agent's objective, its plan (completed and remaining steps), and the changes it has made.\n\n" +
  '**Your Task:**\n' +
  "1.  **Understand the Objective:** Deeply analyze the user's goal. What are the explicit and implicit requirements? What are the success criteria?\n" +
  '2.  **Analyze the Plan & Changes:** Review the completed steps and the code changes. Do they logically move towards the objective? Are they sound engineering practice?\n' +
  '    *   **Trace Execution Flow:** Follow the logic. If a function was changed, where is it called from? What are the downstream impacts?\n' +
  '    *   **Trace Data Flow:** How does data move through the system? Do the changes handle all data types and states correctly (e.g., null, undefined, empty arrays)?\n' +
  '    *   **Verify Assumptions:** The main agent made assumptions. Your job is to verify them by reading the code. Never trust, always verify.\n' +
  '    *   **Look for Edge Cases:** Consider what the main agent might have missed. What happens with invalid input? Race conditions? Security vulnerabilities?\n' +
  '4.  **Formulate a Critique:** Based on your investigation, produce a detailed report.\n' +
  '    *   **Analysis Summary:** Provide a concise summary of your findings.\n' +
  '    *   **Path Correctness:** State clearly whether the agent is on the right path.\n' +
  '    *   **Objective Achievement:** State clearly whether the objective has been fully achieved. If not, what is missing?\n' +
  '    *   **Actionable Feedback:** Provide specific, actionable feedback. Point to exact files and lines. Explain *why* something is wrong and suggest the correct approach.\n\n' +
  '**Core Directives:**\n' +
  '- **BE CRITICAL:** Your value is in finding mistakes. Do not be lenient. Assume the main agent has made errors.\n' +
  '- **BE THOROUGH:** Do not stop at the surface. Dig deep into the codebase to understand the full context and impact of the changes.\n' +
  '- **BE SPECIFIC:** Vague feedback is useless. Refer to file paths, function names, and line numbers.\n' +
  '- **DO NOT IMPLEMENT:** Your role is to critique, not to code. Provide guidance for the main agent to implement.\n\n' +
  'When you are finished, you **MUST** call the `complete_task` tool with a valid JSON report.\n';

/**
 * A subagent specialized in critiquing the work of another agent.
 */
export const CritiqueAgent: AgentDefinition<typeof CritiqueReportSchema> = {
  name: 'critique_agent',
  displayName: 'Critique Agent',
  description:
    'Performs a deep analysis of an objective and the steps taken to achieve it, providing critical feedback.',
  inputConfig: {
    inputs: {
      objective: {
        description: "The main agent's overall objective.",
        type: 'string',
        required: true,
      },
      plan: {
        description: "The main agent's plan.",
        type: 'string', // HACK: No object type, so we'll stringify it.
        required: true,
      },
      changes: {
        description:
          'A list of files edited by the main agent, with a description of the changes.',
        type: 'string', // HACK: No object type, so we'll stringify it.
        required: true,
      },
    },
  },
  outputConfig: {
    outputName: 'critique',
    description: 'The final critique as a JSON object.',
    schema: CritiqueReportSchema,
  },

  processOutput: (output: z.infer<typeof CritiqueReportSchema>) =>
    JSON.stringify(output, null, 2),

  modelConfig: {
    model: DEFAULT_GEMINI_MODEL,
    temp: 0.01,
    top_p: 0.95,
  },

  runConfig: {
    max_time_minutes: 5,
    max_turns: 10,
  },

  toolConfig: {
    tools: [LSTool.Name, ReadFileTool.Name, GLOB_TOOL_NAME, GrepTool.Name],
  },

  promptConfig: {
    query:
      'Please critique the following work:\n' +
      '<Objective>\n${objective}\n</Objective>\n\n' +
      '<Plan>\n${plan}\n</Plan>\n\n' +
      '<Changes>\n${changes}\n</Changes>',
    systemPrompt,
  },
};
