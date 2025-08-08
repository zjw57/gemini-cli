/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult, Icon } from './tools.js';
import { Config } from '../config/config.js';
import {
  SubAgentScope,
  SubagentTerminateMode,
  ContextState,
  PromptConfig,
  ModelConfig,
  RunConfig,
  ToolConfig,
  OutputConfig,
} from '../core/subagent.js';
import { LSTool } from './ls.js';
import { GrepTool } from './grep.js';
import { ReadFileTool } from './read-file.js';
import { GlobTool } from './glob.js';
import { ReadManyFilesTool } from './read-many-files.js';
import { WebSearchTool } from './web-search.js';
import { Type } from '@google/genai';

/**
 * Parameters for the ContextHarvesterTool
 */
export interface ContextHarvesterToolParams {
  research_objective: string;
  context_and_rationale: string;
  include_web_search?: boolean;
}

/**
 * A tool that invokes a specialized subagent to perform deep reconnaissance and return a context summary.
 */
export class ContextHarvesterTool extends BaseTool<
  ContextHarvesterToolParams,
  ToolResult
> {
  static readonly Name = 'research_and_synthesize_context';

  constructor(private config: Config) {
    super(
      ContextHarvesterTool.Name,
      'Research Context',
      `Use this tool when you lack sufficient context about the codebase, environment, or related concepts to proceed with the current task. This is mandatory if initial exploration (like multiple 'grep' or 'ls' calls) is confusing, overwhelming, or insufficient. This tool performs focused, iterative research and synthesizes the findings.`,
      Icon.LightBulb,
      {
        type: Type.OBJECT,
        properties: {
          research_objective: {
            description:
              "A specific, detailed question or description of the information needed. E.g., 'How is user authentication implemented, specifically the JWT validation logic and where is it located?'",
            type: Type.STRING,
          },
          context_and_rationale: {
            description:
              "Explain why you need this information and what you've already tried or observed (prior attempts). E.g., 'I need to add a new claim to the JWT. I grepped for 'jsonwebtoken' but found too many results and need a focused understanding of the core validation flow.'",
            type: Type.STRING,
          },
          include_web_search: {
            description:
              'Whether to allow the researcher to search the web (if the tool is available). Defaults to false. Use if the topic involves external libraries, standards, or general technical knowledge not found in the codebase.',
            type: Type.BOOLEAN,
          },
        },
        required: ['research_objective', 'context_and_rationale'],
      },
    );
  }

  /**
   * Executes the context harvesting operation by invoking a subagent.
   */
  async execute(
    params: ContextHarvesterToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    // 1. Define the Tools (Read-only)
    const observationTools: string[] = [
      LSTool.Name,
      GrepTool.Name,
      GlobTool.Name,
      ReadFileTool.Name,
      ReadManyFilesTool.Name,
    ];

    // Conditionally add WebSearch
    if (params.include_web_search) {
      const toolRegistry = await this.config.getToolRegistry();
      if (toolRegistry.getTool(WebSearchTool.Name)) {
        observationTools.push(WebSearchTool.Name);
      }
    }

    const toolConfig: ToolConfig = {
      tools: observationTools,
    };

    // 2. Define the Prompt for the Harvester Subagent
    const promptConfig: PromptConfig = {
      systemPrompt: this.getHarvesterSystemPrompt(params, observationTools),
    };

    // 3. Define the Expected Outputs
    const outputConfig: OutputConfig = {
      outputs: {
        context_summary:
          'A concise, structured summary of the research findings, adhering strictly to the required format.',
      },
    };

    // 4. Define Model Configuration (Highly deterministic for research)
    const modelConfig: ModelConfig = {
      model: this.config.getModel(),
      temp: 0.1,
      top_p: 1.0,
    };

    // 5. Define Run Configuration (Allow enough turns for deep dives)
    const runConfig: RunConfig = {
      max_time_minutes: 5,
      max_turns: 25,
    };

    try {
      const orchestrator = await SubAgentScope.create(
        'ContextHarvesterAgent',
        this.config,
        promptConfig,
        modelConfig,
        runConfig,
        toolConfig,
        outputConfig,
      );

      const context = new ContextState();
      await orchestrator.runNonInteractive(context);

      const summary = orchestrator.output.emitted_vars['context_summary'];
      const terminationReason = orchestrator.output.terminate_reason;

      if (terminationReason === SubagentTerminateMode.GOAL && summary) {
        // Success case
        return {
          llmContent: summary,
          returnDisplay: summary,
          summary: 'Successfully synthesized context.',
        };
      }

      // Handle cases where the goal wasn't reached or summary wasn't emitted
      let errorMessage = `Context research did not complete successfully. Reason: ${terminationReason}.`;

      // Handle Timeout/MaxTurns: Return partial results if available.
      if (
        terminationReason === SubagentTerminateMode.MAX_TURNS ||
        terminationReason === SubagentTerminateMode.TIMEOUT
      ) {
        errorMessage = `Context research exhausted its allowed time/turns.`;
        if (summary) {
          const partialOutput = `**[Partial Research Summary (Incomplete)]**\n*Note: Research was terminated before completion (${terminationReason}).*\n\n${summary}`;
          return {
            llmContent: partialOutput,
            returnDisplay: partialOutput,
            summary: 'Partially synthesized context (Timeout/MaxTurns).',
          };
        }
      } else if (terminationReason === SubagentTerminateMode.GOAL && !summary) {
        errorMessage =
          'Error: Researcher finished but failed to emit the required context_summary.';
      }

      // Failure case
      return {
        llmContent:
          errorMessage +
          ' Please analyze the partial results (if any) or try an alternative approach.',
        returnDisplay: `**[ContextHarvesterAgent Error]** ${errorMessage}`,
        error: { message: errorMessage },
      };
    } catch (error) {
      return this.handleExecutionError(error);
    }
  }

  private handleExecutionError(error: unknown): ToolResult {
    console.error('ContextHarvesterTool execution failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific error case where tools might be misconfigured as interactive
    if (errorMessage.includes('requires user confirmation')) {
      return {
        llmContent: `Error: Configuration issue prevented the Context Harvester from running. A required tool is configured to ask for user confirmation, which is not supported in this autonomous mode. Details: ${errorMessage}`,
        returnDisplay: `**[ContextHarvesterAgent Error]** Configuration issue: Tool requires user confirmation.`,
        error: { message: errorMessage },
      };
    }

    return {
      llmContent: `Error: An unexpected error occurred while running the context researcher: ${errorMessage}`,
      returnDisplay: `**[ContextHarvesterAgent Error]** Unexpected error: ${errorMessage}`,
      error: { message: errorMessage },
    };
  }

  private getHarvesterSystemPrompt(
    params: ContextHarvesterToolParams,
    observationTools: string[],
  ): string {
    return `
You are a specialized, autonomous Research Agent (a Software Archaeologist). Your sole purpose is to investigate the provided objective, gather relevant information using your tools, and synthesize it into a structured, actionable summary.

# Mission Context

**Research Objective (Your Goal):** ${params.research_objective}

**Context and Rationale (Why this is needed & Prior Attempts):**
${params.context_and_rationale}

# Constraints
1. **Read-Only:** You MUST only use the provided observation tools (${observationTools.join(', ')}). You CANNOT modify the environment.
2. **Focus & Synthesis:** Stay strictly focused on the objective. Your output MUST be synthesized analysis, not raw data dumps.
3. **Efficiency:** Work efficiently. Prioritize 'grep'/'glob' before 'read_file'. Avoid reading large files entirely; use targeted reads. For web searches, use precise queries.
4. **Non-Interactive:** You cannot ask for clarification. You must complete the task autonomously.

# Workflow (Iterative Loop)
1. **Analyze & Hypothesize:** Understand the objective and prior attempts. Determine likely locations (files) or search terms.
2. **Investigate:** Use your tools to gather data.
3. **Analyze Results:** Evaluate findings. If insufficient, return to step 1 and formulate a new hypothesis.
4. **Synthesize (Crucial):** Once you have a comprehensive understanding (or if nearing time/turn limits), compile your findings into the required structure.
5. **Emit Output:** Use the 'self.emitvalue' tool to output the final synthesis under the variable name 'context_summary'.

# Required Output Structure (Markdown):
You MUST adhere to this structure.

## Context Research Summary

### Key Findings
* [Crucial insight 1: Fact-based summary of the most important discovery, citing sources (file paths or URLs).]
* [Crucial insight 2]

### Relevant Files and Snippets
(Curate ONLY the most relevant files. Provide a brief summary AND the most critical, CONCISE code snippet for each.)

**1. \`path/to/file1.ext\`**
* *Summary:* [Why this file is important]
* *Relevant Snippet:*
\`\`\`[language]
// Highly relevant snippet (Keep it short!)
\`\`\`

**2. \`path/to/file2.ext\`** (If applicable)
* *Summary:* [Why this file is important]
* *Relevant Snippet:*
\`\`\`[language]
// Highly relevant snippet
\`\`\`

### Negative Results (Paths Investigated)
(CRITICAL: List significant searches/reads that yielded nothing useful. This prevents the main agent from repeating them.)
* Searched for '[term]' in '[directory]' - No relevant results.
* Examined '[file]' - Not relevant to the objective.
* Web search for '[query]' - Yielded outdated information.

### Recommendations for Next Steps
* [Suggestion for the main agent's immediate next action based on these findings.]
`.trim();
  }
}
