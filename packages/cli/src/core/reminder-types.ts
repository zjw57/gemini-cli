/**
 * The output structure for Context Injection Manager hooks.
 */
export interface CIMOutput {
  // The formatted reminders/interventions to inject into the context.
  reminders: string[];
  // Optional payload to trigger an immediate re-evaluation by the core engine.
  recursivePayload?: Record<string, any>;
}

/**
 * Hooks in the agent lifecycle where CIM can intervene.
 */
export enum ReminderHook {
  StartOfTurn = 'StartOfTurn',
  PreToolExecution = 'PreToolExecution',
  PostToolExecution = 'PostToolExecution',
  PreResponseFinalization = 'PreResponseFinalization',
}

/**
 * Defines the states of the TDD workflow. Numerical order is CRITICAL.
 */
export enum TDDState {
  // 0: Understanding the problem, exploring the codebase.
  EXPLORING = 0,
  // 1: Actively creating a reproduction test case.
  WRITING_TEST = 1,
  // 2: The test case ran and FAILED (bug reproduced). (RED)
  REPRO_FAILED = 2,
  // 3: Implementing the solution.
  WRITING_FIX = 3,
  // 4: The tests ran and ALL PASSED (fix verified). (GREEN)
  FIX_VERIFIED = 4,
  // 5: Reverting temporary tests/debugging code.
  CLEANUP = 5,
}