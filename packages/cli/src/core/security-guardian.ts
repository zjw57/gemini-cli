import type { Config } from '@google/gemini-cli-core';
// We need the GeminiClient instance type
import type { GeminiClient } from '@google/gemini-cli-core';
import type { CIMOutput } from './reminder-types.js';
import { formatReminder } from './reminder-factory.js';

// Explicitly forbidden patterns
const DANGEROUS_PATTERNS = [
  /^sudo\s/,
  /\brm\s+.*-rf?\s*(\/|~)/, // Aggressive deletion near root/home
  /\b(mkfs|fdisk|dd)\b/,
  /:\(\)\{:|\|:&\]\};:/, // Fork bomb
];

// Common, safe commands that bypass LLM analysis
const SAFE_PATTERNS = [
  /^ls\b/,
  /^cat\b/,
  /^grep\b/,
  /^find\b/,
  /^pytest\b/,
  /^npm\s+(test|run)\b/,
  /^pwd\b/,
];

const GUARDIAN_SYSTEM_PROMPT = `
You are a strict security auditor analyzing a shell command proposed by an AI agent in a sandboxed workspace.
Determine if the command is SAFE or UNSAFE.

UNSAFE criteria:
1. Workspace Escape (accessing '/', '/etc', '/home', '~').
2. System Modification or global software installation.
3. Data Exfiltration/Unauthorized Network Access (curl/wget/ssh outside package managers).
4. Inherently destructive commands ('rm -rf', 'shred').

Respond ONLY with "SAFE" or "UNSAFE: [Concise reason]".
`;

export async function invokeGuardian(
  command: string,
  geminiClient: GeminiClient,
  config: Config,
): Promise<CIMOutput> {
  const normalizedCommand = command.trim();

  // 1. Blacklist Check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      return generateIntervention(
        'Command matches known dangerous pattern (Blacklisted).',
        command,
      );
    }
  }

  // 2. Whitelist Check
  if (SAFE_PATTERNS.some((pattern) => pattern.test(normalizedCommand))) {
    return { reminders: [] };
  }

  // 3. LLM Guardian Analysis
  try {
    const prompt = `Proposed Command:\n\
\
\
${command}
\
\
\
`;

    const response = await geminiClient.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        temperature: 0.0,
        maxOutputTokens: 50,
        systemInstruction: GUARDIAN_SYSTEM_PROMPT,
      }, // Strict and concise
      new AbortController().signal,
      config.getModel(),
    );

    // Assuming a standard response structure to extract text
    const resultText =
      (
        response as any
      ).response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // 4. Process Result
    if (resultText.startsWith('SAFE')) {
      return { reminders: [] };
    }

    const reason =
      resultText.replace('UNSAFE:', '').trim() ||
      'Security risk identified by Guardian LLM.';
    return generateIntervention(reason, command);
  } catch (error) {
    console.error('Security Guardian LLM error:', error);
    // Fail closed: If the guardian system fails, block the command.
    return generateIntervention(
      'Security evaluation system failure. Failing closed.',
      command,
    );
  }
}

function generateIntervention(reason: string, command: string): CIMOutput {
  const intervention = formatReminder(
    'SECURITY INTERVENTION: Command Blocked',
    `The proposed shell command was deemed unsafe and has been blocked.\nReason: ${reason}\n\nReview your strategy and propose a safe alternative.`,
  );
  // Crucial: Use recursivePayload to force the model to re-evaluate the turn immediately.
  return {
    reminders: [intervention],
    recursivePayload: { blockedCommand: command },
  };
}
