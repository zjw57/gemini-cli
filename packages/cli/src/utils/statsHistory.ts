/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getProjectTempDir } from '@google/gemini-cli-core';
import type { SessionStats } from './cleanup.js';

interface ModelStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
}

interface AggregatedStats {
  totalSessions: number;
  models: Record<string, ModelStats>;
  totalToolCalls: number;
  firstSessionDate?: Date;
  lastSessionDate?: Date;
}

interface ModelPricing {
  inputPrice: number; // per 1M tokens
  outputPrice: number; // per 1M tokens
  displayName: string;
}

// Pricing table based on provided information (in USD per 1M tokens)
const PRICING_TABLE: Record<string, ModelPricing> = {
  'gemini-2.0-flash-exp': {
    displayName: 'Gemini 2.0 Flash',
    inputPrice: 0.30,
    outputPrice: 2.50,
  },
  'gemini-1.5-flash': {
    displayName: 'Gemini 1.5 Flash',
    inputPrice: 0.30,
    outputPrice: 2.50,
  },
  'gemini-1.5-flash-8b': {
    displayName: 'Gemini 1.5 Flash 8B',
    inputPrice: 0.30,
    outputPrice: 2.50,
  },
  'gemini-1.5-pro': {
    displayName: 'Gemini 1.5 Pro',
    inputPrice: 1.25, // for prompts <= 200k tokens
    outputPrice: 10.00, // for prompts <= 200k tokens
  },
  'gemini-2.0-flash-thinking-exp': {
    displayName: 'Gemini 2.0 Flash Thinking',
    inputPrice: 0.30,
    outputPrice: 2.50, // includes thinking tokens
  },
  'gemini-2.5-pro': {
    displayName: 'Gemini 2.5 Pro',
    inputPrice: 1.25, // for prompts <= 200k tokens
    outputPrice: 10.00, // for prompts <= 200k tokens
  },
  'gemini-2.5-flash': {
    displayName: 'Gemini 2.5 Flash',
    inputPrice: 0.30,
    outputPrice: 2.50,
  },
};

export function readStatsHistory(projectPath?: string): AggregatedStats {
  const stats: AggregatedStats = {
    totalSessions: 0,
    models: {},
    totalToolCalls: 0,
  };

  try {
    const tempDir = getProjectTempDir(projectPath || process.cwd());
    const statsFile = join(tempDir, 'stats.jsonl');
    
    const content = readFileSync(statsFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line);
    
    for (const line of lines) {
      try {
        const sessionStats: SessionStats = JSON.parse(line);
        stats.totalSessions++;
        
        // Update date range
        const sessionDate = new Date(sessionStats.timestamp);
        if (!stats.firstSessionDate || sessionDate < stats.firstSessionDate) {
          stats.firstSessionDate = sessionDate;
        }
        if (!stats.lastSessionDate || sessionDate > stats.lastSessionDate) {
          stats.lastSessionDate = sessionDate;
        }
        
        // Aggregate model stats
        if (sessionStats.models) {
          for (const [modelName, modelData] of Object.entries(sessionStats.models)) {
            if (!stats.models[modelName]) {
              stats.models[modelName] = {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalRequests: 0,
              };
            }
            
            if (modelData.api) {
              stats.models[modelName].totalRequests += modelData.api.totalRequests || 0;
            }
            if (modelData.tokens) {
              stats.models[modelName].totalInputTokens += modelData.tokens.prompt || 0;
              stats.models[modelName].totalOutputTokens += modelData.tokens.candidates || 0;
            }
          }
        }
        
        // Aggregate tool stats
        if (sessionStats.tools) {
          stats.totalToolCalls += sessionStats.tools.totalCalls || 0;
        }
      } catch (e) {
        // Skip malformed lines
        console.debug('Skipping malformed stats line:', e);
      }
    }
  } catch (e) {
    // File doesn't exist or other error
    console.debug('Error reading stats history:', e);
  }
  
  return stats;
}

export function calculateCosts(stats: AggregatedStats): Record<string, { inputCost: number; outputCost: number; totalCost: number; displayName: string }> {
  const costs: Record<string, { inputCost: number; outputCost: number; totalCost: number; displayName: string }> = {};
  
  for (const [modelName, modelStats] of Object.entries(stats.models)) {
    const pricing = PRICING_TABLE[modelName] || {
      displayName: modelName,
      inputPrice: 0,
      outputPrice: 0,
    };
    
    const inputCost = (modelStats.totalInputTokens / 1_000_000) * pricing.inputPrice;
    const outputCost = (modelStats.totalOutputTokens / 1_000_000) * pricing.outputPrice;
    
    costs[modelName] = {
      displayName: pricing.displayName,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }
  
  return costs;
}

export function formatStatsReport(stats: AggregatedStats): string {
  const costs = calculateCosts(stats);
  const lines: string[] = [];
  
  lines.push('📊 Gemini CLI Usage Report');
  lines.push('═'.repeat(50));
  
  if (stats.totalSessions === 0) {
    lines.push('No usage data found.');
    return lines.join('\n');
  }
  
  // Date range
  if (stats.firstSessionDate && stats.lastSessionDate) {
    lines.push(`\n📅 Period: ${stats.firstSessionDate.toLocaleDateString()} - ${stats.lastSessionDate.toLocaleDateString()}`);
  }
  
  lines.push(`\n📈 Summary:`);
  lines.push(`  • Total sessions: ${stats.totalSessions}`);
  lines.push(`  • Total tool calls: ${stats.totalToolCalls.toLocaleString()}`);
  
  // Model usage and costs
  lines.push(`\n💰 Token Usage & Estimated Costs:`);
  
  let totalCost = 0;
  for (const [modelName, modelStats] of Object.entries(stats.models)) {
    const cost = costs[modelName];
    totalCost += cost.totalCost;
    
    lines.push(`\n  ${cost.displayName}:`);
    lines.push(`    • Requests: ${modelStats.totalRequests.toLocaleString()}`);
    lines.push(`    • Input tokens: ${modelStats.totalInputTokens.toLocaleString()}`);
    lines.push(`    • Output tokens: ${modelStats.totalOutputTokens.toLocaleString()}`);
    lines.push(`    • Estimated cost: $${cost.totalCost.toFixed(4)}`);
    lines.push(`      (Input: $${cost.inputCost.toFixed(4)}, Output: $${cost.outputCost.toFixed(4)})`);
  }
  
  lines.push(`\n💵 Total Estimated Cost: $${totalCost.toFixed(4)}`);
  
  lines.push('\n' + '─'.repeat(50));
  lines.push('Note: Costs are estimates based on standard pricing.');
  lines.push('Actual costs may vary based on your specific plan.');
  
  return lines.join('\n');
}