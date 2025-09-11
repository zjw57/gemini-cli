import { TDDState } from './reminder-types.js';

/**
 * Formats a reminder using XML-like tags for high visibility to the LLM.
 */
export function formatReminder(title: string, body: string): string {
  // Indent the body for readability within the instruction block
  const formattedBody = body.trim().replace(/\n/g, '\n  ');
  return `
<system-instruction>
  <title>${title.toUpperCase()}</title>
  <instruction>
  ${formattedBody}
  </instruction>
</system-instruction>
`;
}

const TDD_STATE_GOALS: Record<TDDState, string> = {
  [TDDState.EXPLORING]: "Understand the architecture and locate the source of the bug. Identify relevant test files.",
  [TDDState.WRITING_TEST]: "Write a minimal test case that executes the buggy code path. The goal is for this test to FAIL (RED).",
  [TDDState.REPRO_FAILED]: "Bug confirmed (RED). Analyze the failure and implement the minimal necessary fix.",
  [TDDState.WRITING_FIX]: "Implement the code changes. Run tests repeatedly until they pass (GREEN).",
  [TDDState.FIX_VERIFIED]: "Fix verified (GREEN). Enter CLEANUP phase: revert temporary tests or debug code.",
  [TDDState.CLEANUP]: "Ensure all temporary changes are reverted and tests still pass. Generate the final patch.",
};

// Mapping numeric enum to string names for display
const TDD_STATE_NAMES: Record<TDDState, string> = {
    [TDDState.EXPLORING]: "EXPLORING",
    [TDDState.WRITING_TEST]: "WRITING_TEST",
    [TDDState.REPRO_FAILED]: "REPRO_FAILED",
    [TDDState.WRITING_FIX]: "WRITING_FIX",
    [TDDState.FIX_VERIFIED]: "FIX_VERIFIED",
    [TDDState.CLEANUP]: "CLEANUP",
};

export function getTDDStateGoal(state: TDDState): string {
  return TDD_STATE_GOALS[state] || "Unknown objective.";
}

export function getTDDStateName(state: TDDState): string {
    return TDD_STATE_NAMES[state] || "UNKNOWN";
}

export function getGlobalBehaviorReminders(projectRoot: string): string[] {
  const body = `
    1. **WORKSPACE PATHS (CRITICAL):** All file paths MUST be absolute, starting with 
${projectRoot}
. Do not use relative paths.
    2. **CONTEXT VERIFICATION:** Always verify file contents with 'cat' or 'read_file' immediately before using 'edit' or 'replace'. 'old_string' must match exactly (including whitespace).
    3. **TDD MANDATE:** Do NOT apply fixes before reproducing the bug with a failing test (achieving REPRO_FAILED state).
    4. **MINIMALISM & STYLE:** Ensure edits are minimal. PERFECTLY match the surrounding code style.
`;
  return [formatReminder('Global Behavior & Constraints', body)];
}

export function getExplorationToolkitReminder(): string {
    const body = `Prioritize efficient exploration:
    - Use \`grep -r "keyword"\` to find code/content.
    - Use \`grep "import "\` to trace dependencies and understand architecture.
    - Use \`find . -name "*file*"\` to locate files by name.
    - AVOID broad \`ls\` at the root level.`;
    return formatReminder('Exploration Toolkit', body);
}