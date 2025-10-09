/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { getShellConfiguration } from '../packages/core/src/utils/shell-utils.js';

const { shell } = getShellConfiguration();

function getLineCountCommand(): { command: string; tool: string } {
  switch (shell) {
    case 'powershell':
      return {
        command: `(Get-Content test.txt).Length`,
        tool: 'Get-Content',
      };
    case 'cmd':
      return { command: `find /c /v "" test.txt`, tool: 'find' };
    case 'bash':
    default:
      return { command: `wc -l test.txt`, tool: 'wc' };
  }
}

describe('run_shell_command', () => {
  it('should combine multiple --allowed-tools flags', async () => {
    const rig = new TestRig();
    await rig.setup('should combine multiple --allowed-tools flags');

    const { tool } = getLineCountCommand();
    const prompt = `use ${tool} and ls`;

    const result = await rig.run({
      stdin: prompt,
      args: [
        `--allowed-tools=run_shell_command(${tool})`,
        '--allowed-tools=run_shell_command(ls)',
      ],
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command', 15000);

    if (!foundToolCall) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
      });
    }

    expect(
      foundToolCall,
      'Expected to find a run_shell_command tool call',
    ).toBeTruthy();
  });

  //TODO - https://github.com/google-gemini/gemini-cli/issues/10768
  it.skip('should allow all with "ShellTool" and other specifics', async () => {
    const rig = new TestRig();
    await rig.setup('should allow all with "ShellTool" and other specifics');

    const { tool } = getLineCountCommand();
    const prompt = `use date`;

    const result = await rig.run({
      stdin: prompt,
      args: [
        `--allowed-tools=run_shell_command(${tool})`,
        '--allowed-tools=run_shell_command',
      ],
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command', 15000);

    if (!foundToolCall) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
      });
    }

    expect(
      foundToolCall,
      'Expected to find a run_shell_command tool call',
    ).toBeTruthy();
  });

  it('should propagate environment variables to the child process', async () => {
    const rig = new TestRig();
    await rig.setup('should propagate environment variables');

    const varName = 'GEMINI_CLI_TEST_VAR';
    const varValue = `test-value-${Math.random().toString(36).substring(7)}`;
    process.env[varName] = varValue;

    try {
      const prompt = `Use echo to learn the value of the environment variable named ${varName} and tell me what it is.`;
      const result = await rig.run(prompt);

      const foundToolCall = await rig.waitForToolCall('run_shell_command');

      if (!foundToolCall || !result.includes(varValue)) {
        printDebugInfo(rig, result, {
          'Found tool call': foundToolCall,
          'Contains varValue': result.includes(varValue),
        });
      }

      expect(
        foundToolCall,
        'Expected to find a run_shell_command tool call',
      ).toBeTruthy();
      validateModelOutput(result, varValue, 'Env var propagation test');
      expect(result).toContain(varValue);
    } finally {
      delete process.env[varName];
    }
  });
});
