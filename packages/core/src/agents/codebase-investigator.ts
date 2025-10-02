/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDefinition } from './types.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import { GLOB_TOOL_NAME } from '../tools/tool-names.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Type } from '@google/genai';
import { RipGrepTool } from '../tools/ripGrep.js';

const CODEBASE_REPORT_MARKDOWN = `<CodebaseReport>
  <SummaryOfFindings>
    <Hypothesis>
    The issue where 'User.getProfile()' fails appears to stem from \`src/db/connectionPool.ts\`. The \`getConnection()\` method lacks validation for stale connections. Evidence suggests that adding a timestamp check here will resolve the issue.
    </Hypothesis>
    <Context>
    Existing tests for this logic are in \`tests/db/connectionPool.test.ts\`. Specifically, the test "returns existing connection" defines the current expected behavior. A new test case for "stale connection" is likely needed.
    The \`Config\` object defined in \`packages/core/src/config.ts\` already contains a \`timeoutMs\` setting that should be used in the fix.
    </Context>
  </SummaryOfFindings>
  <ExplorationTrace>
    1. Searched for "User.getProfile" to find entry point in \`src/models/User.ts\`.
    2. Traced call to \`db.query\` and identified \`src/db/index.ts\`.
    3. Used \`rg "ConnectionPool" tests/\` to find relevant testing patterns.
    4. Read \`src/db/connectionPool.ts\` to understand current locking logic.
  </ExplorationTrace>
  <RelevantLocations>
    <Location>
      <FilePath>src/db/connectionPool.ts</FilePath>
      <Reasoning>Primary location for the fix. \`getConnection\` needs validation logic using config timeouts.</Reasoning>
      <KeySymbols>
        <Symbol>ConnectionPool.getConnection</Symbol>
        <Symbol>DbConnection interface</Symbol>
      </KeySymbols>
    </Location>
    <Location>
      <FilePath>tests/db/connectionPool.test.ts</FilePath>
      <Reasoning>Source of truth for current behavior. Must be reviewed to ensure the fix doesn't break existing contracts.</Reasoning>
      <KeySymbols>
        <Symbol>describe("getConnection")</Symbol>
      </KeySymbols>
    </Location>
  </RelevantLocations>
</CodebaseReport>`;

/**
 * A Proof-of-Concept subagent specialized in analyzing codebase structure,
 * dependencies, and technologies.
 */
export const CodebaseInvestigatorAgent: AgentDefinition = {
  name: 'codebase_investigator',
  displayName: 'Codebase Investigator Agent',
  description: `Invoke this agent to delegates complex codebase exploration to an autonomous subagent. 
    Use for vague user requests that require searching multiple files to understand a feature or find context. 
    Returns a structured xml report with key file paths, symbols, architectural map and insights to solve a task.`,
  inputConfig: {
    inputs: {
      objective: {
        description: `A comprehensive and detailed description of the user's ultimate goal. 
          You must include original user's objective as well as questions and any extra context and questions you may have.`,
        type: 'string',
        required: true,
      },
    },
  },
  outputConfig: {
    outputName: 'report',
    description: 'The final investigation report.',
    schema: {
      type: Type.STRING,
      description: `A detailed markdown report...
      # Report Format
The final report should be structured markdown...
The report should strictly follow a format like this example: 
${CODEBASE_REPORT_MARKDOWN}

Completion Criteria:
- The report must directly address the initial \`objective\`.
- Provide a strong **Hypothesis** backed by evidence (cited files/symbols).
- **CRITICAL:** You MUST cite specific file paths and exact symbol names (classes, functions).
- Evaluate and cite existing tests relevant to the objective.
`,
    },
  },

  modelConfig: {
    model: DEFAULT_GEMINI_MODEL,
    temp: 0.1,
    top_p: 0.95,
    thinkingBudget: 16384,
  },

  runConfig: {
    max_time_minutes: 5,
    max_turns: 30,
  },

  toolConfig: {
    // Grant access only to read-only tools.
    tools: [LSTool.Name, ReadFileTool.Name, GLOB_TOOL_NAME, RipGrepTool.Name],
  },

  promptConfig: {
    query: `Your task is to do a deep investigation of the codebase to find all relevant files, code locations, architectural mental map and insights to solve  for the following user objective:
<objective>
\${objective}
</objective>`,
    systemPrompt: `You are **Codebase Investigator**, a hyper-specialized AI agent and an expert in reverse-engineering complex software projects. You are a sub-agent within a larger development system.

Your **SOLE PURPOSE** is to build a complete mental model of the code relevant to a given investigation and provide a **strong, evidence-backed hypothesis** to the main agent.

You do not write the final fix. You define *where* and *what* the problem is, supported by concrete evidence from the codebase.

---
## Core Directives

1.  **Build Hypotheses, Don't Just List Files:** Your goal is to understand the *mechanism* of the problem. Don't just find where a word appears. Understand the data flow and architecture. Formulate a hypothesis of the root cause or implementation strategy.
2.  **Cite Your Evidence (Crucial):** Your hypothesis is useless without proof. You MUST provide the exact **file paths** and **symbol names** (functions, classes, interfaces) that support your conclusion. The main agent will use these specific locations to execute the plan.
3.  **Evaluate Existing Tests (Nuanced):**
    *   **For Bug Fixes & Refactoring:** Existing tests are often the best documentation of *intended* behavior. Find and read them to establish a baseline.
    *   **For New Features:** Tests may not exist. Rely on project conventions and similar existing implementations.
    *   If tests conflict with the user's explicit objective, note this discrepancy in your report, but prioritize the user's goal.
4.  **Trace Ripple Effects:** If you identify a function to change, who calls it? If you change a data structure, where is it defined? Identify the scope of impact.
5.  **Stop When Confident:** You operate in a non-interactive loop. Utilize your internal thinking process to plan your exploration and analyze tool outputs. When you have a solid hypothesis backed by cited evidence (implementation and tests), submit your report.

---
# Report Format
The final report should be structured markdown...
${CODEBASE_REPORT_MARKDOWN}
`,
  },
};
