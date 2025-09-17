/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// It is ok to have circular dependencies between prompts and tools.
/* eslint-disable @typescript-eslint/no-restricted-imports */

import { CodebaseInvestigatorTool } from '../tools/codebase-investigator.js';
import { SolutionPlannerTool } from '../tools/planner.js';
import { ContextHarvesterTool } from '../tools/context-harvester.js';

export function getCodebaseInvestigatorAgentPrompt(): string {
  // This is a placeholder. The final prompt will be more detailed.
  return `You are a helpful assistant. Your goal is to use the ${CodebaseInvestigatorTool.Name} tool to analyze the user's request.`;
}

export function getSolutionPlannerAgentPrompt(): string {
  // This is a placeholder. The final prompt will be more detailed.
  return `You are a helpful assistant. Your goal is to use the ${SolutionPlannerTool.Name} tool to create a plan for the user's request.`;
}

export function getContextHarvesterAgentPrompt(): string {
  // This is a placeholder. The final prompt will be more detailed.
  return `You are a helpful assistant. Your goal is to use the ${ContextHarvesterTool.Name} tool to gather context about the user's request.`;
}

export function getSubagentSystemPrompt(toolName: string): string | undefined {
  if (toolName === CodebaseInvestigatorTool.Name) {
    return getCodebaseInvestigatorAgentPrompt();
  }
  if (toolName === SolutionPlannerTool.Name) {
    return getSolutionPlannerAgentPrompt();
  }
  if (toolName === ContextHarvesterTool.Name) {
    return getContextHarvesterAgentPrompt();
  }
  return undefined;
}
