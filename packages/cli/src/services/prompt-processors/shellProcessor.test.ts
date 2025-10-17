/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ConfirmationRequiredError, ShellProcessor } from './shellProcessor.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from '../../ui/commands/types.js';
import type { Config } from '@google/gemini-cli-core';
import { ApprovalMode, getShellConfiguration } from '@google/gemini-cli-core';
import { quote } from 'shell-quote';
import { createPartFromText } from '@google/genai';
import type { PromptPipelineContent } from './types.js';

// Helper function to determine the expected escaped string based on the current OS,
// mirroring the logic in the actual `escapeShellArg` implementation.
function getExpectedEscapedArgForPlatform(arg: string): string {
  const { shell } = getShellConfiguration();

  switch (shell) {
    case 'powershell':
      return `'${arg.replace(/'/g, "''")}'`;
    case 'cmd':
      return `"${arg.replace(/"/g, '""')}"`;
    case 'bash':
    default:
      return quote([arg]);
  }
}

// Helper to create PromptPipelineContent
function createPromptPipelineContent(text: string): PromptPipelineContent {
  return [createPartFromText(text)];
}

const mockCheckCommandPermissions = vi.hoisted(() => vi.fn());
const mockShellExecute = vi.hoisted(() => vi.fn());

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    checkCommandPermissions: mockCheckCommandPermissions,
    ShellExecutionService: {
      execute: mockShellExecute,
    },
  };
});

const SUCCESS_RESULT = {
  output: 'default shell output',
  exitCode: 0,
  error: null,
  aborted: false,
  signal: null,
};

describe('ShellProcessor', () => {
  let context: CommandContext;
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      getTargetDir: vi.fn().mockReturnValue('/test/dir'),
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      getEnableInteractiveShell: vi.fn().mockReturnValue(false),
      getShellExecutionConfig: vi.fn().mockReturnValue({}),
    };

    context = createMockCommandContext({
      invocation: {
        raw: '/cmd default args',
        name: 'cmd',
        args: 'default args',
      },
      services: {
        config: mockConfig as Config,
      },
      session: {
        sessionShellAllowlist: new Set(),
      },
    });

    mockShellExecute.mockReturnValue({
      result: Promise.resolve(SUCCESS_RESULT),
    });

    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: true,
      disallowedCommands: [],
    });
  });

  it('should throw an error if config is missing', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent('!{ls}');
    const contextWithoutConfig = createMockCommandContext({
      services: {
        config: null,
      },
    });

    await expect(
      processor.process(prompt, contextWithoutConfig),
    ).rejects.toThrow(/Security configuration not loaded/);
  });

  it('should not change the prompt if no shell injections are present', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'This is a simple prompt with no injections.',
    );
    const result = await processor.process(prompt, context);
    expect(result).toEqual(prompt);
    expect(mockShellExecute).not.toHaveBeenCalled();
  });

  it('should process a single valid shell injection if allowed', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'The current status is: !{git status}',
    );
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: true,
      disallowedCommands: [],
    });
    mockShellExecute.mockReturnValue({
      result: Promise.resolve({ ...SUCCESS_RESULT, output: 'On branch main' }),
    });

    const result = await processor.process(prompt, context);

    expect(mockCheckCommandPermissions).toHaveBeenCalledWith(
      'git status',
      expect.any(Object),
      context.session.sessionShellAllowlist,
    );
    expect(mockShellExecute).toHaveBeenCalledWith(
      'git status',
      expect.any(String),
      expect.any(Function),
      expect.any(Object),
      false,
      expect.any(Object),
    );
    expect(result).toEqual([{ text: 'The current status is: On branch main' }]);
  });

  it('should process multiple valid shell injections if all are allowed', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      '!{git status} in !{pwd}',
    );
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: true,
      disallowedCommands: [],
    });

    mockShellExecute
      .mockReturnValueOnce({
        result: Promise.resolve({
          ...SUCCESS_RESULT,
          output: 'On branch main',
        }),
      })
      .mockReturnValueOnce({
        result: Promise.resolve({ ...SUCCESS_RESULT, output: '/usr/home' }),
      });

    const result = await processor.process(prompt, context);

    expect(mockCheckCommandPermissions).toHaveBeenCalledTimes(2);
    expect(mockShellExecute).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ text: 'On branch main in /usr/home' }]);
  });

  it('should throw ConfirmationRequiredError if a command is not allowed in default mode', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Do something dangerous: !{rm -rf /}',
    );
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: false,
      disallowedCommands: ['rm -rf /'],
    });

    await expect(processor.process(prompt, context)).rejects.toThrow(
      ConfirmationRequiredError,
    );
  });

  it('should NOT throw ConfirmationRequiredError if a command is not allowed but approval mode is YOLO', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Do something dangerous: !{rm -rf /}',
    );
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: false,
      disallowedCommands: ['rm -rf /'],
    });
    // Override the approval mode for this test
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);
    mockShellExecute.mockReturnValue({
      result: Promise.resolve({ ...SUCCESS_RESULT, output: 'deleted' }),
    });

    const result = await processor.process(prompt, context);

    // It should proceed with execution
    expect(mockShellExecute).toHaveBeenCalledWith(
      'rm -rf /',
      expect.any(String),
      expect.any(Function),
      expect.any(Object),
      false,
      expect.any(Object),
    );
    expect(result).toEqual([{ text: 'Do something dangerous: deleted' }]);
  });

  it('should still throw an error for a hard-denied command even in YOLO mode', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Do something forbidden: !{reboot}',
    );
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: false,
      disallowedCommands: ['reboot'],
      isHardDenial: true, // This is the key difference
      blockReason: 'System commands are blocked',
    });
    // Set approval mode to YOLO
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);

    await expect(processor.process(prompt, context)).rejects.toThrow(
      /Blocked command: "reboot". Reason: System commands are blocked/,
    );

    // Ensure it never tried to execute
    expect(mockShellExecute).not.toHaveBeenCalled();
  });

  it('should throw ConfirmationRequiredError with the correct command', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Do something dangerous: !{rm -rf /}',
    );
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: false,
      disallowedCommands: ['rm -rf /'],
    });

    try {
      await processor.process(prompt, context);
      // Fail if it doesn't throw
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      if (e instanceof ConfirmationRequiredError) {
        expect(e.commandsToConfirm).toEqual(['rm -rf /']);
      }
    }

    expect(mockShellExecute).not.toHaveBeenCalled();
  });

  it('should throw ConfirmationRequiredError with multiple commands if multiple are disallowed', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      '!{cmd1} and !{cmd2}',
    );
    mockCheckCommandPermissions.mockImplementation((cmd) => {
      if (cmd === 'cmd1') {
        return { allAllowed: false, disallowedCommands: ['cmd1'] };
      }
      if (cmd === 'cmd2') {
        return { allAllowed: false, disallowedCommands: ['cmd2'] };
      }
      return { allAllowed: true, disallowedCommands: [] };
    });

    try {
      await processor.process(prompt, context);
      // Fail if it doesn't throw
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      if (e instanceof ConfirmationRequiredError) {
        expect(e.commandsToConfirm).toEqual(['cmd1', 'cmd2']);
      }
    }
  });

  it('should not execute any commands if at least one requires confirmation', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'First: !{echo "hello"}, Second: !{rm -rf /}',
    );

    mockCheckCommandPermissions.mockImplementation((cmd) => {
      if (cmd.includes('rm')) {
        return { allAllowed: false, disallowedCommands: [cmd] };
      }
      return { allAllowed: true, disallowedCommands: [] };
    });

    await expect(processor.process(prompt, context)).rejects.toThrow(
      ConfirmationRequiredError,
    );

    // Ensure no commands were executed because the pipeline was halted.
    expect(mockShellExecute).not.toHaveBeenCalled();
  });

  it('should only request confirmation for disallowed commands in a mixed prompt', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Allowed: !{ls -l}, Disallowed: !{rm -rf /}',
    );

    mockCheckCommandPermissions.mockImplementation((cmd) => ({
      allAllowed: !cmd.includes('rm'),
      disallowedCommands: cmd.includes('rm') ? [cmd] : [],
    }));

    try {
      await processor.process(prompt, context);
      expect.fail('Should have thrown ConfirmationRequiredError');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      if (e instanceof ConfirmationRequiredError) {
        expect(e.commandsToConfirm).toEqual(['rm -rf /']);
      }
    }
  });

  it('should execute all commands if they are on the session allowlist', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Run !{cmd1} and !{cmd2}',
    );

    // Add commands to the session allowlist
    context.session.sessionShellAllowlist = new Set(['cmd1', 'cmd2']);

    // checkCommandPermissions should now pass for these
    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: true,
      disallowedCommands: [],
    });

    mockShellExecute
      .mockReturnValueOnce({
        result: Promise.resolve({ ...SUCCESS_RESULT, output: 'output1' }),
      })
      .mockReturnValueOnce({
        result: Promise.resolve({ ...SUCCESS_RESULT, output: 'output2' }),
      });

    const result = await processor.process(prompt, context);

    expect(mockCheckCommandPermissions).toHaveBeenCalledWith(
      'cmd1',
      expect.any(Object),
      context.session.sessionShellAllowlist,
    );
    expect(mockCheckCommandPermissions).toHaveBeenCalledWith(
      'cmd2',
      expect.any(Object),
      context.session.sessionShellAllowlist,
    );
    expect(mockShellExecute).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ text: 'Run output1 and output2' }]);
  });

  it('should trim whitespace from the command inside the injection before interpolation', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent = createPromptPipelineContent(
      'Files: !{  ls {{args}} -l  }',
    );

    const rawArgs = context.invocation!.args;

    const expectedEscapedArgs = getExpectedEscapedArgForPlatform(rawArgs);

    const expectedCommand = `ls ${expectedEscapedArgs} -l`;

    mockCheckCommandPermissions.mockReturnValue({
      allAllowed: true,
      disallowedCommands: [],
    });
    mockShellExecute.mockReturnValue({
      result: Promise.resolve({ ...SUCCESS_RESULT, output: 'total 0' }),
    });

    await processor.process(prompt, context);

    expect(mockCheckCommandPermissions).toHaveBeenCalledWith(
      expectedCommand,
      expect.any(Object),
      context.session.sessionShellAllowlist,
    );
    expect(mockShellExecute).toHaveBeenCalledWith(
      expectedCommand,
      expect.any(String),
      expect.any(Function),
      expect.any(Object),
      false,
      expect.any(Object),
    );
  });

  it('should handle an empty command inside the injection gracefully (skips execution)', async () => {
    const processor = new ShellProcessor('test-command');
    const prompt: PromptPipelineContent =
      createPromptPipelineContent('This is weird: !{}');

    const result = await processor.process(prompt, context);

    expect(mockCheckCommandPermissions).not.toHaveBeenCalled();
    expect(mockShellExecute).not.toHaveBeenCalled();

    // It replaces !{} with an empty string.
    expect(result).toEqual([{ text: 'This is weird: ' }]);
  });

  describe('Error Reporting', () => {
    it('should append exit code and command name on failure', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent =
        createPromptPipelineContent('!{cmd}');
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({
          ...SUCCESS_RESULT,
          output: 'some error output',
          stderr: '',
          exitCode: 1,
        }),
      });

      const result = await processor.process(prompt, context);

      expect(result).toEqual([
        {
          text: "some error output\n[Shell command 'cmd' exited with code 1]",
        },
      ]);
    });

    it('should append signal info and command name if terminated by signal', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent =
        createPromptPipelineContent('!{cmd}');
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({
          ...SUCCESS_RESULT,
          output: 'output',
          stderr: '',
          exitCode: null,
          signal: 'SIGTERM',
        }),
      });

      const result = await processor.process(prompt, context);

      expect(result).toEqual([
        {
          text: "output\n[Shell command 'cmd' terminated by signal SIGTERM]",
        },
      ]);
    });

    it('should throw a detailed error if the shell fails to spawn', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent =
        createPromptPipelineContent('!{bad-command}');
      const spawnError = new Error('spawn EACCES');
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({
          ...SUCCESS_RESULT,
          stdout: '',
          stderr: '',
          exitCode: null,
          error: spawnError,
          aborted: false,
        }),
      });

      await expect(processor.process(prompt, context)).rejects.toThrow(
        "Failed to start shell command in 'test-command': spawn EACCES. Command: bad-command",
      );
    });

    it('should report abort status with command name if aborted', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent = createPromptPipelineContent(
        '!{long-running-command}',
      );
      const spawnError = new Error('Aborted');
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({
          ...SUCCESS_RESULT,
          output: 'partial output',
          stderr: '',
          exitCode: null,
          error: spawnError,
          aborted: true, // Key difference
        }),
      });

      const result = await processor.process(prompt, context);
      expect(result).toEqual([
        {
          text: "partial output\n[Shell command 'long-running-command' aborted]",
        },
      ]);
    });
  });

  describe('Context-Aware Argument Interpolation ({{args}})', () => {
    const rawArgs = 'user input';

    beforeEach(() => {
      // Update context for these tests to use specific arguments
      context.invocation!.args = rawArgs;
    });

    it('should perform raw replacement if no shell injections are present (optimization path)', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent = createPromptPipelineContent(
        'The user said: {{args}}',
      );

      const result = await processor.process(prompt, context);

      expect(result).toEqual([{ text: `The user said: ${rawArgs}` }]);
      expect(mockShellExecute).not.toHaveBeenCalled();
    });

    it('should perform raw replacement outside !{} blocks', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent = createPromptPipelineContent(
        'Outside: {{args}}. Inside: !{echo "hello"}',
      );
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({ ...SUCCESS_RESULT, output: 'hello' }),
      });

      const result = await processor.process(prompt, context);

      expect(result).toEqual([{ text: `Outside: ${rawArgs}. Inside: hello` }]);
    });

    it('should perform escaped replacement inside !{} blocks', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent = createPromptPipelineContent(
        'Command: !{grep {{args}} file.txt}',
      );
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({ ...SUCCESS_RESULT, output: 'match found' }),
      });

      const result = await processor.process(prompt, context);

      const expectedEscapedArgs = getExpectedEscapedArgForPlatform(rawArgs);
      const expectedCommand = `grep ${expectedEscapedArgs} file.txt`;

      expect(mockShellExecute).toHaveBeenCalledWith(
        expectedCommand,
        expect.any(String),
        expect.any(Function),
        expect.any(Object),
        false,
        expect.any(Object),
      );

      expect(result).toEqual([{ text: 'Command: match found' }]);
    });

    it('should handle both raw (outside) and escaped (inside) injection simultaneously', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent = createPromptPipelineContent(
        'User "({{args}})" requested search: !{search {{args}}}',
      );
      mockShellExecute.mockReturnValue({
        result: Promise.resolve({ ...SUCCESS_RESULT, output: 'results' }),
      });

      const result = await processor.process(prompt, context);

      const expectedEscapedArgs = getExpectedEscapedArgForPlatform(rawArgs);
      const expectedCommand = `search ${expectedEscapedArgs}`;
      expect(mockShellExecute).toHaveBeenCalledWith(
        expectedCommand,
        expect.any(String),
        expect.any(Function),
        expect.any(Object),
        false,
        expect.any(Object),
      );

      expect(result).toEqual([
        { text: `User "(${rawArgs})" requested search: results` },
      ]);
    });

    it('should perform security checks on the final, resolved (escaped) command', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent =
        createPromptPipelineContent('!{rm {{args}}}');

      const expectedEscapedArgs = getExpectedEscapedArgForPlatform(rawArgs);
      const expectedResolvedCommand = `rm ${expectedEscapedArgs}`;
      mockCheckCommandPermissions.mockReturnValue({
        allAllowed: false,
        disallowedCommands: [expectedResolvedCommand],
        isHardDenial: false,
      });

      await expect(processor.process(prompt, context)).rejects.toThrow(
        ConfirmationRequiredError,
      );

      expect(mockCheckCommandPermissions).toHaveBeenCalledWith(
        expectedResolvedCommand,
        expect.any(Object),
        context.session.sessionShellAllowlist,
      );
    });

    it('should report the resolved command if a hard denial occurs', async () => {
      const processor = new ShellProcessor('test-command');
      const prompt: PromptPipelineContent =
        createPromptPipelineContent('!{rm {{args}}}');
      const expectedEscapedArgs = getExpectedEscapedArgForPlatform(rawArgs);
      const expectedResolvedCommand = `rm ${expectedEscapedArgs}`;
      mockCheckCommandPermissions.mockReturnValue({
        allAllowed: false,
        disallowedCommands: [expectedResolvedCommand],
        isHardDenial: true,
        blockReason: 'It is forbidden.',
      });

      await expect(processor.process(prompt, context)).rejects.toThrow(
        `Blocked command: "${expectedResolvedCommand}". Reason: It is forbidden.`,
      );
    });
  });
  describe('Real-World Escaping Scenarios', () => {
    it('should correctly handle multiline arguments', async () => {
      const processor = new ShellProcessor('test-command');
      const multilineArgs = 'first line\nsecond line';
      context.invocation!.args = multilineArgs;
      const prompt: PromptPipelineContent = createPromptPipelineContent(
        'Commit message: !{git commit -m {{args}}}',
      );

      const expectedEscapedArgs =
        getExpectedEscapedArgForPlatform(multilineArgs);
      const expectedCommand = `git commit -m ${expectedEscapedArgs}`;

      await processor.process(prompt, context);

      expect(mockShellExecute).toHaveBeenCalledWith(
        expectedCommand,
        expect.any(String),
        expect.any(Function),
        expect.any(Object),
        false,
        expect.any(Object),
      );
    });

    it.each([
      { name: 'spaces', input: 'file with spaces.txt' },
      { name: 'double quotes', input: 'a "quoted" string' },
      { name: 'single quotes', input: "it's a string" },
      { name: 'command substitution (backticks)', input: '`reboot`' },
      { name: 'command substitution (dollar)', input: '$(reboot)' },
      { name: 'variable expansion', input: '$HOME' },
      { name: 'command chaining (semicolon)', input: 'a; reboot' },
      { name: 'command chaining (ampersand)', input: 'a && reboot' },
    ])('should safely escape args containing $name', async ({ input }) => {
      const processor = new ShellProcessor('test-command');
      context.invocation!.args = input;
      const prompt: PromptPipelineContent =
        createPromptPipelineContent('!{echo {{args}}}');

      const expectedEscapedArgs = getExpectedEscapedArgForPlatform(input);
      const expectedCommand = `echo ${expectedEscapedArgs}`;

      await processor.process(prompt, context);

      expect(mockShellExecute).toHaveBeenCalledWith(
        expectedCommand,
        expect.any(String),
        expect.any(Function),
        expect.any(Object),
        false,
        expect.any(Object),
      );
    });
  });
});
