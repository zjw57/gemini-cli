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
You are an elite, autonomous software engineer on a **fact-finding mission**, operating as a "Context Harvester." Your purpose is to execute a mission by methodically exploring a codebase using a limited set of tools. You are relentlessly goal-oriented, efficient, and precise.
You operate in a non-interactive loop and CANNOT ask for clarification. You must reason from the information provided and the output of your tools.
<MISSION>
You will be given a mission briefing. Your sole focus is to complete this mission.
* **High-Level Objective:** \${user_objective}
* **Checklist (Questions to Answer):** \${analysis_questions}
* **Hypotheses to Verify:** \${initial_hypotheses}
* **Known Entry Points:** \${entry_points}
* **Exclusion Patterns:** \${exclusion_patterns}
</MISSION>
<RULES>
1.  **FOCUS:** Your primary directive is to complete every item on the Checklist. Do not explore unrelated paths.
2.  **THINK FIRST:** You MUST ALWAYS output a <thought> block before a <tool_code> block. Your thought must explain your reasoning for the chosen action.
3.  **EFFICIENT ACTIONS:** You can and should execute multiple tool calls in a single <tool_code> block if they are logically independent and contribute to the same reasoning step. For example, if you identify two promising files, you can read them both at once. Do not chain dependent actions in the same turn.
4.  **STATEFULNESS:** You MUST meticulously update your <scratchpad> after every observation. Marking paths as irrelevant is critical for efficiency.
5.  **SELF-CORRECTION:** If a tool call fails or returns no useful information, you MUST note this in your scratchpad and adjust your plan in your next thought. Do not retry the same failed action.
</RULES>
<WORKFLOW_LOOP_EXAMPLE>
This is the exact structure you MUST follow for every turn until your mission is complete.
<scratchpad>
**Checklist Progress:**
- [ ] What is the function name for processing payments?
- [ ] Where is the tax calculation logic located?
**Key Findings:**
- Discovered \`PaymentService.ts\` via grep, seems relevant.
**Irrelevant Paths to Ignore:**
- \`/docs/\`
- \`tests/mocks/\`
</scratchpad>
<thought>
My last action was to grep for "payment". The result pointed to \`PaymentService.ts\`. I need to understand its contents to find the payment processing function name. My next step is to read this file.
</thought>
<tool_code>
read_file(absolute_path='src/services/PaymentService.ts')
</tool_code>
</WORKFLOW_LOOP_EXAMPLE>
<TERMINATION>
Your mission is complete ONLY when every item on your Checklist is marked as complete in your scratchpad. On your final turn, you will not call a standard tool. Instead, your final thought will justify why the mission is complete, and you will then call the \`self.emitvalue\` tool to return the final, comprehensive JSON report.
Your final output MUST be structured as follows:
<scratchpad>
**Checklist Progress:**
- [x] What is the function name for processing payments?
- [x] Where is the tax calculation logic located?
**Key Findings:**
- The main payment function is \`processTransaction\` in \`PaymentService.ts\`.
- Tax logic is in \`utils/tax.py\` in the \`calculate_tax\` function.
**Irrelevant Paths to Ignore:**
- /docs/
- tests/mocks/
</scratchpad>
<thought>
I have successfully answered all questions on my checklist and verified all hypotheses. I have gathered all necessary information. My mission is complete. I will now format and emit the final report.
</thought>
<tool_code>
self.emitvalue(
  emit_variable_name='report_json',
  emit_variable_value='{
    "summary_of_findings": "The core payment logic is in \`PaymentService.ts\`...",
    "answered_questions": [{"question": "...", "answer": "...", "evidence_paths": ["..."]}],
    "relevant_locations": [{"file_path": "src/services/PaymentService.ts", "reasoning": "Contains the main transaction processing logic.", "key_symbols_or_lines": ["processTransaction"]}],
    "irrelevant_paths": ["/docs/", "tests/mocks/"],
    "entry_point_recommendation": "Begin by modifying the \`processTransaction\` function in \`src/services/PaymentService.ts\`.",
    "exploration_trace": "Started with grep for payment -> read PaymentService.ts -> Discovered import of tax.py -> read tax.py."
  }'
)
</tool_code>
`;

/**
 * The structured input required by the ContextHarvesterTool.
 * This serves as the formal "mission briefing" from the central agent.
 */
export interface ContextHarvesterInput {
  /** High-level summary of the user's ultimate goal. Provides the "north star". */
  user_objective: string;
  /** Specific questions the Harvester must answer, forming its internal checklist. */
  analysis_questions: string[];
  /** Educated guesses from the Central Agent for the Harvester to verify. */
  initial_hypotheses?: string[];
  /** Known relevant files or directories to provide a "warm start". */
  entry_points?: string[];
  /** Glob patterns for files/directories to explicitly ignore during the search. */
  exclusion_patterns?: string[];
}

/**
 * The structured report generated by the Context Harvester subagent.
 * This is the "intelligent compression" of its findings.
 */
export interface ContextHarvesterOutput {
  /** A high-level, natural language summary directly addressing the analysis_questions. */
  summary_of_findings: string;
  /** Direct answers to the specific questions posed in the initial task specification. */
  answered_questions: Array<{
    question: string;
    answer: string;
    evidence_paths: string[];
  }>;
  /** Curated list of the most significant code locations discovered. */
  relevant_locations: Array<{
    file_path: string;
    reasoning: string; // Why this location is significant to the objective.
    key_symbols_or_lines: string[]; // e.g., "function processPayment", "lines 45-60"
  }>;
  /** Files investigated and explicitly ruled out (negative findings). */
  irrelevant_paths: string[];
  /** The Harvester's recommendation for where the Orchestrator should begin modifications. */
  entry_point_recommendation: string;
  /** A brief, human-readable log of the Harvester's main exploration steps. */
  exploration_trace: string;
}

class ContextHarvesterInvocation extends BaseToolInvocation<
  ContextHarvesterInput,
  ToolResult
> {
  constructor(
    private config: Config,
    params: ContextHarvesterInput,
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
          'The final JSON report structured according to the ContextHarvesterOutput schema.',
      },
    };

    const promptConfig: PromptConfig = {
      systemPrompt: CONTEXT_HARVESTER_SYSTEM_PROMPT,
    };

    // 2. Initialize and Run the Sub-Agent Scope
    let harvesterScope: SubAgentScope;
    try {
      harvesterScope = await SubAgentScope.create(
        'ContextHarvester',
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
    contextState.set(
      'analysis_questions',
      JSON.stringify(this.params.analysis_questions || []),
    );
    contextState.set(
      'initial_hypotheses',
      JSON.stringify(this.params.initial_hypotheses || ['N/A']),
    );
    contextState.set(
      'entry_points',
      JSON.stringify(this.params.entry_points || ['N/A']),
    );
    contextState.set(
      'exclusion_patterns',
      JSON.stringify(this.params.exclusion_patterns || ['N/A']),
    );

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

export class ContextHarvesterTool extends BaseDeclarativeTool<
  ContextHarvesterInput,
  ToolResult
> {
  static readonly Name = 'context_harvester';

  constructor(private config: Config) {
    super(
      ContextHarvesterTool.Name,
      'Context Harvester',
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
          analysis_questions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Specific questions the Harvester must answer, forming its internal checklist.',
          },
          initial_hypotheses: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional: Educated guesses from the Central Agent for the Harvester to verify.',
          },
          entry_points: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional: Known relevant files or directories to provide a "warm start".',
          },
          exclusion_patterns: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional: Glob patterns for files/directories to explicitly ignore.',
          },
        },
        required: ['user_objective', 'analysis_questions'],
      },
      false, // isOutputMarkdown = false, as the output is structured JSON for the agent
    );
  }

  protected createInvocation(
    params: ContextHarvesterInput,
  ): ToolInvocation<ContextHarvesterInput, ToolResult> {
    return new ContextHarvesterInvocation(this.config, params);
  }
}
