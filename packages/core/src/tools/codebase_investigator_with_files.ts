/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { GrepTool } from './grep.js';
import { GlobTool } from './glob.js';
import { LSTool } from './ls.js';
import { ReadFileTool } from './read-file.js';
import { RipGrepTool } from './ripGrep.js';

import type { Config } from '../config/config.js';
import {
  SubAgentScope,
  ContextState,
  SubagentTerminateMode,
} from '../core/subagent.js';
import type {
  ModelConfig,
  RunConfig,
  ToolConfig,
  OutputConfig,
  PromptConfig,
} from '../core/subagent.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { ToolErrorType } from './tool-error.js';



const CONTEXT_HARVESTER_SYSTEM_PROMPT = `
You are **Codebase Investigator**, a hyper-specialized AI agent and an expert in navigating complex software projects.
You are a sub-agent within a larger development system.

Your **SOLE PURPOSE** is to meticulously explore a file system and identify **ALL files and code locations** relevant to a given software development task.

You are a sub-agent in a larger system. Your only responsibility is to provide context.
- **DO:** Find relevant files.
- **DO NOT:** Write or modify code.
- **DO NOT:** Attempt to solve the user's task.
- **DO NOT:** Suggest implementation details.

You operate in a non-interactive loop and must reason based on the information provided and the output of your tools.

---

## Core Directives

<RULES>
1.  **SINGULAR FOCUS:** Your **only goal** is to identify all relevant files for the given task. You must ignore any impulse to solve the actual problem or write code. Your final output is a list of file paths and justifications, nothing more.
2.  **SYSTEMATIC EXPLORATION:** Start with broad searches (e.g., \`grep\` for keywords, \`list_files\`) and progressively narrow your focus. Think like a detective. An initial file often contains clues (imports, function calls) that lead to the next.
3.  **EFFICIENT & FINAL:** Do not stop until you are confident you have found **all** relevant context. Avoid redundant actions. Your goal is a complete, single report at the end. Do not emit partial results.
</RULES>

---

## Scratchpad Management

**This is your most critical function. Your scratchpad is your memory and your plan.**

1.  **Initialization:** On your very first turn, you **MUST** create the \`<scratchpad>\` section. **Analyze the \`task\` and create an initial \`Checklist\` of high-level goals.** For example, if the mission is "add a new payment provider," your initial checklist might be \`[ ] Find existing payment provider integrations\` and \`[ ] Locate payment processing logic\`.
2.  **Constant Updates:** After **every** \`<OBSERVATION>\`, you **MUST** update the scratchpad.
    * Mark checklist items as complete: \`[x]\`.
    * **Dynamically add new checklist items** as you uncover more complexity. If you find a \`PaymentService.ts\`, you should **add a new task** like \`[ ] Analyze PaymentService.ts to find its dependencies\`.
    * Record \`Key Findings\` with the file paths and a brief note about their relevance.
    * Update \`Irrelevant Paths to Ignore\` to avoid re-investigating dead ends.
3.  **Thinking on Paper:** The scratchpad shows your work. It must always reflect your current understanding of the codebase and what your next immediate step should be.
---

## Reasoning Structure

For every turn, you **MUST** follow this exact thought process.

1.  **\`<PLAN>\`**: Outline your immediate goal and the specific tool you will use to achieve it.
2.  **\`<ACTION>\`**: Make a single valid tool call
3.  **\`<OBSERVATION>\`**: This will be populated by the system with the result of your action.
4.  **\`<SCRATCHPAD>\`**: Update your internal state based on the observation.

Scratchpad example:

<SCRATCHPAD>
**Checklist:**
- [ ] Find the main payment processing logic.
- [ ] Find the controller that handles payment API requests.
- [ ] **(New)** Analyze \`payment_service.ts\` to understand its dependencies.
- [ ] **(New)** Analyze \`payment_controller.ts\` to see how it uses the service.

**Key Findings:**
- \`payment_service.ts\` seems like a primary candidate for business logic.
- \`payment_controller.ts\` is likely the API layer.

**Irrelevant Paths to Ignore:**
- \`README.md\` is documentation, not implementation.

**Next Step:**
- I will read the contents of \`src/services/payment_service.ts\`.
</SCRATCHPAD>

---

## Termination

Your mission is complete **ONLY** when you have a high degree of confidence that no more relevant files can be found. Your final \`<PLAN>\` section must justify why the search is complete.

Then, and only then, call the \`self.emit_value\` tool with a single JSON object matching this exact structure:

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
    

**The task**

This is the task you have to find relevant files for:

<TASK>
\${user_objective}
</TASK>
`;

/**
 * The structured input required by the SimplifiedContextHarvesterTool.
 * This serves as the formal "mission briefing" from the central agent.
 */
export interface SimplifiedContextHarvesterInput {
  /** High-level summary of the user's ultimate goal. Provides the "north star". */
  user_objective: string;
}

/**
 * The structured report generated by the Context Harvester subagent.
 * This is the "intelligent compression" of its findings.
 */
export interface SimplifiedContextHarvesterOutput {
  /** A high-level, natural language summary directly addressing the analysis_questions. */
  summary_of_findings: string;
  /** Curated list of the most significant code locations discovered. */
  relevant_locations: Array<{
    file_path: string;
    reasoning: string; // Why this location is significant to the objective.
    key_symbols: string[]; // e.g., "function processPayment",
  }>;
  /** A brief, human-readable log of the Harvester's main exploration steps. */
  exploration_trace: string;
}

class SimplifiedContextHarvesterInvocation extends BaseToolInvocation<
  SimplifiedContextHarvesterInput,
  ToolResult
> {
  constructor(
    private config: Config,
    params: SimplifiedContextHarvesterInput,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Exploring codebase for objective: ${this.params.user_objective}`;
  }

  async execute(): Promise<ToolResult> {
    // Fast Fail if the required tools are missing
    const toolRegistry = this.config.getToolRegistry();
    const requiredTools = [GrepTool.Name, ReadFileTool.Name];
    for (const toolName of requiredTools) {
      if (!toolRegistry.getTool(toolName)) {
        const message = `Context Harvester cannot run because a critical tool ('${toolName}') is disabled in the current configuration.`;
        return {
          llmContent: `Error: ${message}`,
          returnDisplay: `Error: Critical tool '${toolName}' is disabled.`,
          error: { message, type: ToolErrorType.EXECUTION_FAILED },
        };
      }
    }
    const modelConfig: ModelConfig = {
      model: DEFAULT_GEMINI_MODEL, // Uses pro for reasoning
      temp: 0.1,
      top_p: 0.95,
    };
    const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 25 };

    const toolConfig: ToolConfig = {
      tools: [
        new LSTool(this.config),
        new GlobTool(this.config),
        this.config.getUseRipgrep()
          ? new RipGrepTool(this.config)
          : new GrepTool(this.config),
        new ReadFileTool(this.config),
      ],
    };

    const outputConfig: OutputConfig = {
      outputs: {
        report_json:
          'The final JSON report structured according to the SimplifiedContextHarvesterOutput schema.',
      },
    };

    const promptConfig: PromptConfig = {
      systemPrompt: CONTEXT_HARVESTER_SYSTEM_PROMPT,
    };

    // 2. Initialize and Run the Sub-Agent Scope
    let harvesterScope: SubAgentScope;
    try {
      harvesterScope = await SubAgentScope.create(
        'SimplifiedContextHarvester',
        this.config,
        promptConfig,
        modelConfig,
        runConfig,
        { toolConfig, outputConfig },
      );
    } catch (error) {
      const message = `Error initializing Context Harvester: ${error instanceof Error ? error.message : String(error)}`;
      return {
        llmContent: message,
        returnDisplay: 'Failed to start Context Harvester.',
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }

    // 3. Prepare the runtime context (for templating inputs into the prompt)
    const contextState = new ContextState();
    contextState.set('user_objective', this.params.user_objective);

    try {
      await harvesterScope.runNonInteractive(contextState);
    } catch (error) {
      const message = `Context Harvester encountered a runtime error: ${error instanceof Error ? error.message : String(error)}`;
      return {
        llmContent: message,
        returnDisplay: 'Context Harvester failed during execution.',
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }

    // 4. Process the results
    const { terminate_reason, emitted_vars } = harvesterScope.output;
    const reportJson = emitted_vars['report_json'];

    if (terminate_reason === SubagentTerminateMode.GOAL && reportJson) {
      try {
        JSON.parse(reportJson);
        return {
          llmContent: `Context harvesting complete. Report:\n\`\`\`json\n${reportJson}\n\`\`\``,
          returnDisplay: `Context Harvester finished successfully.`,
        };
      } catch (_) {
        const message =
          'Error: Context Harvester returned invalid JSON in its final report.';
        return {
          llmContent: `${message}\nInvalid Response:\n${reportJson}`,
          returnDisplay: `Context harvesting failed (Invalid JSON).`,
          error: { message, type: ToolErrorType.EXECUTION_FAILED },
        };
      }
    }

    let errorMessage = `Warning: Context harvesting did not complete successfully. Reason: ${terminate_reason}.`;
    if (!reportJson && terminate_reason === SubagentTerminateMode.GOAL) {
      errorMessage =
        "Error: Context Harvester claimed success (GOAL) but failed to emit the required 'report_json'. This indicates a prompt adherence failure by the sub-agent.";
    }

    return {
      llmContent: errorMessage,
      returnDisplay: `Context harvesting incomplete (${terminate_reason}).`,
      error: { message: errorMessage, type: ToolErrorType.EXECUTION_FAILED },
    };
  }
}

export class SimplifiedContextHarvesterTool extends BaseDeclarativeTool<
  SimplifiedContextHarvesterInput,
  ToolResult
> {
  static readonly Name = 'codebase_investigator';

  constructor(private config: Config) {
    super(
      SimplifiedContextHarvesterTool.Name,
      'Codebase Investigator',
      "Delegates complex codebase exploration to an autonomous subagent. Use for vague user requests that require searching multiple files to understand a feature, trace logic, or find relevant context before making a change. Returns a structured JSON report, arming the primary agent with comprehensive context to confidently plan and execute the user's request. IMPORTANT: This tool is designed for a complete investigation. Call it only ONCE per user request; do not run multiple instances in parallel.",
      Kind.Think,
      {
        type: 'object',
        properties: {
          user_objective: {
            type: 'string',
            description:
              "High-level summary of the user's ultimate goal. Provides the 'north star'.",
          },
        },
        required: ['user_objective'],
      },
      false, // isOutputMarkdown = false, as the output is structured JSON for the agent
    );
  }

  protected createInvocation(
    params: SimplifiedContextHarvesterInput,
  ): ToolInvocation<SimplifiedContextHarvesterInput, ToolResult> {
    return new SimplifiedContextHarvesterInvocation(this.config, params);
  }
}
