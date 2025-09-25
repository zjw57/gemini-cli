/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, Kind } from './tools.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseSubAgentInvocation } from './base-subagent-tool.js';
import type { Config } from '../config/config.js';
import type { ContextState } from '../core/subagent.js';
import { processSingleFileContent } from '../utils/fileUtils.js';
import fs from 'node:fs';
import type { Content } from '@google/genai';

const OUTPUT_SCHEMA_JSON = `
\`\`\`json
{
    "summary_of_findings": "A brief, one-sentence summary of the architectural role of the discovered files.",
    "relevant_locations": [
        {
            "file_path": "src/services/payment_service.ts",
            "reasoning": "Contains the core business logic for processing payments and interacting with external gateways.",
            "key_symbols": ["PaymentService", "processTransaction"]
        }
    ],
    "exploration_trace": "1. Grepped for 'payment'. 2. Read 'payment_service.ts'. 3. Discovered import of 'tax_calculator.ts' and read it. 4. Grepped for 'PaymentService' to find its usage in 'payment_controller.ts'."
}
\`\`\`
`;

const SYSTEM_PROMPT = `
You are **Codebase Investigator**, a hyper-specialized AI agent and an expert in reverse-engineering complex software projects. You are a sub-agent within a larger development system.

Your **SOLE PURPOSE** is to build a complete mental model of the code relevant to a given task. You must identify all relevant files, understand their roles, and foresee the direct architectural consequences of potential changes.

You are a sub-agent in a larger system. Your only responsibility is to provide deep, actionable context.
- **DO:** Find the key modules, classes, and functions that are part of the problem and its solution.
- **DO:** Understand *why* the code is written the way it is. Question everything.
- **DO:** Foresee the ripple effects of a change. If \`function A\` is modified, you must check its callers. If a data structure is altered, you must identify where its type definitions need to be updated.
- **DO NOT:** Write the final implementation code yourself.
- **DO NOT:** Stop at the first relevant file. Your goal is a comprehensive understanding of the entire relevant subsystem.

You operate in a non-interactive loop and must reason based on the information provided and the output of your tools.

---

## Core Directives

<RULES>
1.  **DEEP ANALYSIS, NOT JUST FILE FINDING:** Your goal is to understand the *why* behind the code. Don't just list files; explain their purpose and the role of their key components. Your final report should empower another agent to make a correct and complete fix.
2.  **SYSTEMATIC & CURIOUS EXPLORATION:** Start with high-value clues (like tracebacks or ticket numbers) and broaden your search as needed. Think like a senior engineer doing a code review. An initial file contains clues (imports, function calls, puzzling logic). **If you find something you don't understand, you MUST prioritize investigating it until it is clear.** Treat confusion as a signal to dig deeper.
3.  **HOLISTIC & PRECISE:** Your goal is to find the complete and minimal set of locations that need to be understood or changed. Do not stop until you are confident you have considered the side effects of a potential fix (e.g., type errors, breaking changes to callers, opportunities for code reuse).
4.  **Web Search:** You are allowed to use the \`web_fetch\` tool to research libraries, language features, or concepts you don't understand (e.g., "what does gettext.translation do with localedir=None?").
</RULES>
---

## Scratchpad Management
**This is your most critical function. Your scratchpad is your memory and your plan.**
1.  **Initialization:** On your very first turn, you **MUST** create the \`<scratchpad>\` section. Analyze the \`task\` and create an initial \`Checklist\` of investigation goals and a \`Questions to Resolve\` section for any initial uncertainties.
2.  **Constant Updates:** After **every** \`<OBSERVATION>\`, you **MUST** update the scratchpad.
    *   Mark checklist items as complete: \`[x]\`.
    *   Add new checklist items as you trace the architecture.
    *   **Explicitly log questions in \`Questions to Resolve\`** (e.g., \`[ ] What is the purpose of the 'None' element in this list?\`). Do not consider your investigation complete until this list is empty.
    *   Record \`Key Findings\` with file paths and notes about their purpose and relevance.
    *   Update \`Irrelevant Paths to Ignore\` to avoid re-investigating dead ends.
3.  **Thinking on Paper:** The scratchpad must show your reasoning process, including how you resolve your questions.
---
## Scratchpad
For every turn, you **MUST** update your internal state based on the observation.
Scratchpad example:
<SCRATCHPAD>
**Checklist:**
- [x] Find the main translation loading logic.
- [ ] **(New)** Investigate the \`gettext.translation\` function to understand its arguments.
- [ ] **(New)** Check the signature of \`locale.init\` and its callers for type consistency.
**Questions to Resolve:**
- [x] ~~What is the purpose of the 'None' element in the \`locale_dirs\` list?~~ **Finding:** It's for system-wide gettext catalogs.
**Key Findings:**
- \`sphinx/application.py\`: Assembles the \`locale_dirs\` list. The order is critical.
- \`sphinx/locale/__init__.py\`: Consumes \`locale_dirs\`. Its \`init\` function signature might need a type hint update if \`None\` is passed.
**Irrelevant Paths to Ignore:**
- \`README.md\`
**Next Step:**
- I will use \`web_fetch\` to search for "python gettext translation localedir None" to resolve my open question.
</SCRATCHPAD>

## Termination

Your mission is complete **ONLY** when your \`Questions to Resolve\` list is empty and you are confident you have identified all files and necessary change *considerations*. Your final call MUST be to the \`self.emit_value\` tool. Pass a single argument named \`report_json\` to it, containing a stringified JSON object with your complete findings. The report must include implications of the proposed changes.

\`\`\`json
{
    "summary_of_findings": "A brief summary of the root cause and the architectural components involved.",
    "relevant_locations": [
        {
            "file_path": "sphinx/application.py",
            "reasoning": "This file assembles the search path for locale directories. The bug is caused by incorrect ordering, which prioritizes internal translations over user-provided ones. Fixing the directory order in \`application.py\` will involve passing a list containing \`None\`. Therefore, the type signature of the consuming function \`init\` in \`sphinx/locale/__init__.py\` must be updated from \`List[str]\` to \`List[Optional[str]]\` to avoid type errors.",
            "key_symbols": ["Sphinx._init_i18n"]
        }
    ],
    "exploration_trace": "1. Searched for 'locale_dirs'. 2. Identified \`application.py\` and the line constructing the list. 3. Noticed the \`None\` element was 'puzzling'. 4. Investigated \`gettext\` documentation to understand \`localedir=None\`. 5. Confirmed the fix requires reordering and also requires updating the type hint in the \`locale.init\` function where the list is used."
}
\`\`\`
`;

/**
 * The structured input required by the CodebaseInvestigator.
 */
export interface CodebaseInvestigatorInput {
  /** High-level summary of the user's ultimate goal. */
  user_objective: string;
  /** If true, the content of the relevant files will be included in the final report. */
  include_file_content?: boolean;
}

/**
 * The structured report generated by the Codebase Investigator subagent.
 */
export interface CodebaseInvestigatorOutput {
  /** A high-level, natural language summary of the findings. */
  summary_of_findings: string;
  /** Curated list of the most significant code locations discovered. */
  relevant_locations: Array<{
    file_path: string;
    reasoning: string;
    key_symbols: string[];
    content?: string;
  }>;
  /** A brief, human-readable log of the Investigator's main exploration steps. */
  exploration_trace: string;
}

class CodebaseInvestigatorInvocation extends BaseSubAgentInvocation<
  CodebaseInvestigatorInput,
  CodebaseInvestigatorOutput
> {
  constructor(config: Config, params: CodebaseInvestigatorInput) {
    super(config, params);
  }

  getAgentName(): string {
    return 'CodebaseInvestigator';
  }

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  override getInitialMessages(): Content[] {
    return [
      {
        role: 'user',
        parts: [
          {
            text: `Your task is to investigate the codebase to find all relevant files and code locations for the following user objective:
<USER_OBJECTIVE>
${this.params.user_objective}
</USER_OBJECTIVE>`,
          },
        ],
      },
    ];
  }

  getOutputSchemaName(): string {
    return 'CodebaseInvestigatorOutput';
  }

  override getOutputSchema(): string {
    return OUTPUT_SCHEMA_JSON;
  }

  populateContextState(contextState: ContextState): void {
    contextState.set('user_objective', this.params.user_objective);
  }

  getDescription(): string {
    return `Exploring codebase for objective: ${this.params.user_objective}`;
  }

  /**
   * Post-processes the sub-agent's report to include file content if requested.
   */

  protected convertReportToXmlString(
    report: CodebaseInvestigatorOutput,
  ): string {
    // Map each location object to its XML representation
    const locationsXml = report.relevant_locations
      .map((location) => {
        // Map each key symbol to a <Symbol> tag
        const keySymbolsXml = location.key_symbols
          .map((symbol) => `      <Symbol>${symbol}</Symbol>`)
          .join('\n');

        // If content exists, wrap it in a CDATA block to handle special characters
        const contentXml = location.content
          ? `    <Content><![CDATA[\n${location.content}\n]]></Content>\n`
          : '';

        // Assemble the XML for a single location
        return `  <Location>
      <FilePath>${location.file_path}</FilePath>
      <Reasoning>${location.reasoning}</Reasoning>
      <KeySymbols>
        ${keySymbolsXml}
      </KeySymbols>
        ${contentXml}  
      </Location>`;
      })
      .join('\n');

    // Assemble the final report
    return `<CodebaseReport>
    <SummaryOfFindings>${report.summary_of_findings}</SummaryOfFindings>
    <ExplorationTrace>${report.exploration_trace}</ExplorationTrace>
    <RelevantLocations>
  ${locationsXml}
    </RelevantLocations>
  </CodebaseReport>`;
  }

  protected override async postProcessResult(
    reportJson: string,
  ): Promise<string> {
    const report = JSON.parse(reportJson) as CodebaseInvestigatorOutput;

    if (this.params.include_file_content) {
      for (const location of report.relevant_locations) {
        try {
          const fileStats = await fs.promises.stat(location.file_path);
          if (fileStats.isFile()) {
            const result = await processSingleFileContent(
              location.file_path,
              this.config.getTargetDir(),
              this.config.getFileSystemService(),
            );

            if (!result.error && typeof result.llmContent === 'string') {
              location.content = result.llmContent;
            }
          }
        } catch (_e) {
          // Ignore errors if file doesn't exist or is not accessible
        }
      }
    }
    return this.convertReportToXmlString(report);
  }
}

export class CodebaseInvestigatorTool extends BaseDeclarativeTool<
  CodebaseInvestigatorInput,
  ToolResult
> {
  static readonly Name = 'codebase_investigator';

  constructor(private config: Config) {
    super(
      CodebaseInvestigatorTool.Name,
      'Codebase Investigator',
      'Delegates complex codebase exploration to an autonomous subagent. Use for vague user requests that require searching multiple files to understand a feature or find context. Returns a structured JSON report with key file paths. Can optionally include the content of found files.',
      Kind.Think,
      {
        type: 'object',
        properties: {
          user_objective: {
            type: 'string',
            description:
              "High-level summary of the user's ultimate goal. Provides the 'north star'.",
          },
          include_file_content: {
            type: 'boolean',
            description:
              'If true, the content of the relevant files will be included in the final report.',
          },
        },
        required: ['user_objective'],
      },
      false, // isOutputMarkdown = false, as the output is structured JSON for the agent
    );
  }

  protected createInvocation(
    params: CodebaseInvestigatorInput,
  ): ToolInvocation<CodebaseInvestigatorInput, ToolResult> {
    return new CodebaseInvestigatorInvocation(this.config, params);
  }
}
