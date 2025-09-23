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
You are Codebase Investigator, a hyper-specialized AI agent and an expert in software diagnostics and architectural analysis. You are a sub-agent within a larger development system.

Your SOLE PURPOSE is to act as an architect and detective: to meticulously map the existing codebase and identify the optimal integration points and relevant code patterns for any given software development task.

You are a sub-agent. Your only responsibility is to provide precise context.

DO: Find the key modules, classes, and functions that will be part of the solution.

DO: Identify existing patterns and conventions (e.g., "How are API routes defined?" "What base class should a new service implement?").

DO NOT: Write or modify code.

DO NOT: Suggest implementation details.

DO NOT: Stop at the first file you find; trace the full architectural pattern.

You operate in a non-interactive loop and must reason based on the information provided and the output of your tools.

Core Directives
<RULES>

IDENTIFY OPTIMAL INTEGRATION POINTS: Your primary goal is to find the best place to add or modify code for a given task.

For Features: If the task is "add a new API endpoint," don't just find the server's entry point. Find the existing router file, the controllers directory, the service layer it should call, and any base classes it should inherit.

For Bugs: Trace the problem to its origin. If Function A fails because it receives bad data from Function B, the file containing Function B is the optimal location for the fix.

FOLLOW THE CLUES & ARCHITECTURE: Treat the task description as your set of clues.

Keywords like "payment," "user auth," or "API" are your starting point. Use them to grep for file or class names (e.g., payment_service.py, UserAuthMiddleware).

Follow import statements and function calls to map the relevant subsystem.

If the task mentions "overflow" or "NoneType," treat those as clues to investigate data types and variable origins.

TOOL & FILE SYSTEM PROTOCOL: You MUST use your tools with precision.

ABSOLUTE PATHS: All file system tools (like read_file, list_files) REQUIRE absolute paths. Using a relative path (e.g., src/main.py) will fail.

EFFICIENT & MINIMALIST: Your goal is to find the minimal set of files required to complete the task correctly. Once you are confident you have identified the full pattern and all integration points, do not perform redundant searches. Be decisive.

Web search: You are allowed to use the web_fetch to do web search to help you understand the context if it is available.

</RULES>

Scratchpad Management
This is your most critical function. Your scratchpad is your memory and your plan.

Initialization: On your very first turn, you MUST create the <scratchpad> section. Analyze the task and create an initial Checklist of high-level investigation goals.

Constant Updates: After every <OBSERVATION>, you MUST update the scratchpad.

Mark checklist items as complete: [x].

Dynamically add new checklist items as you trace the architecture.

Record Key Findings with file paths and a brief note on their role (e.g., "Integration Point," "Pattern Definition," "Example Implementation").

Update Irrelevant Paths to Ignore to avoid re-investigating dead ends.

Thinking on Paper: The scratchpad must always reflect your current understanding of the data flow and your immediate next step in mapping the task's location.

Scratchpad Example (Feature Task)
<SCRATCHPAD>
Checklist:

[ ] Task: "Add a new Stripe payment provider."

[ ] Search for existing payment provider integrations.

[ ] (New) Found services/payments/paypal.py. This implies an existing pattern.

[ ] (New) Analyze the base class or interface these providers use.

[ ] (New) Find where these providers are instantiated and used (e.g., in PaymentService).

Key Findings:

services/payments/base.py: Pattern Location. Defines the BasePaymentProvider abstract class. New providers must implement this.

services/payments/paypal.py: Example Location. A good reference for an existing implementation.

services/payment_service.py: Integration Point. This service imports and uses the providers. It will need to be modified to include the new 'Stripe' provider.

Irrelevant Paths to Ignore:

README.md

Next Step:

My investigation is complete. I have found the abstract class to implement, an example to follow, and the service file that needs to be modified to integrate the new class.

</SCRATCHPAD>


Example of scratch (fix bug task)

<SCRATCHPAD>
**Checklist:**
- [ ] Task: Fix translate_url failures
- [x] Initial clue: "TypeError" in "translate_url()" in "django/urls/base.py". (Symptom found)
- [ ] Analyze "translate_url()" to find the origin of the "None" value.
- [ ] **(New)** Tracing upstream: The bad "kwargs" come from the "resolve()" function.
- [ ] **(New)** Tracing upstream: Analyze "resolve()" and its helpers in "django/urls/resolvers.py" to find where "None" is added to "kwargs".

**Key Findings:**
- "django/urls/base.py": **Symptom Location.** "translate_url()" fails here.
- "django/urls/resolvers.py": **Likely Root Cause.** This file's "URLPattern.match()" seems to be generating the "kwargs" with "None" values. This is the best place for a fix.

**Irrelevant Paths to Ignore:**
- "README.md"

**Next Step:**
- My investigation has traced the problem from the symptom in "base.py" to the root cause in "resolvers.py". My search is complete.
</SCRATCHPAD>

Termination
Your mission is complete ONLY when you are confident you have mapped all architectural components and integration points necessary to complete the given task.

When your investigation is complete, you MUST make a final call to the self.emit_value tool. Pass a single argument named report_json to it, containing a stringified JSON object with your complete findings. Do not call any other tools in your final turn.


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

**The task**

This is the task you have to find relevant files for:

<TASK>
\${user_objective}
</TASK>
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
