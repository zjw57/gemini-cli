/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { summarizeToolOutput } from './summarizer.js';
import { GeminiClient } from '../core/client.js';

const TOOL_OUTPUT_THRESHOLD = 2000;

export interface SaveToolOutputResult {
  content: string;
  filePath?: string;
}

function logAndPrint(message: string) {
  console.log(message);
  process.stdout.write(message + '\n');
}

export async function saveToolOutput(
  output: string,
  sessionId: string,
  geminiClient: GeminiClient,
  signal: AbortSignal,
  tokenBudget?: number,
): Promise<SaveToolOutputResult> {
  logAndPrint('Checking if tool output should be saved...');
  if (output.length > TOOL_OUTPUT_THRESHOLD) {
    const fileName = `${sessionId}_tool_call_${crypto.randomUUID()}.log`;
    const filePath = path.join(os.homedir(), fileName);
    logAndPrint(`Saving tool output to ${filePath}`);
    fs.writeFileSync(filePath, output);

    const summary = await summarizeToolOutput(
      output,
      geminiClient,
      signal,
      tokenBudget,
    );

    const summaryFileName = fileName.replace('.log', '.summary');
    const summaryFilePath = path.join(os.homedir(), summaryFileName);
    logAndPrint(`Saving tool output summary to ${summaryFilePath}`);
    fs.writeFileSync(summaryFilePath, summary);

    return {
      content: summary,
      filePath: fileName,
    };
  }

  return {
    content: output,
  };
}
