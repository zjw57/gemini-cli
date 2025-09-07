/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum ReminderHook {
  StartOfTurn = 'start_of_turn',
  PreToolExecution = 'pre_tool_execution',
  PostToolExecution = 'post_tool_execution',
  PreResponseFinalization = 'pre_response_finalization',
}

export enum ReminderType {
  Static = 'static',
  Dynamic = 'dynamic',
  Conditional = 'conditional',
}

export interface SystemReminder {
  id: string;
  hook: ReminderHook;
  type: ReminderType;
  trigger: (payload: any) => boolean;
  content: (payload: any) => string;
}

export interface CIMOutput {
  reminders: string[]; // Formatted XML strings
  blockAction?: boolean; // For Hook B to prevent tool execution
  promptForConfirmation?: string; // For Hook B to ask user
  recursivePayload?: any; // For Hook D to re-trigger model call
}
