/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import EventEmitter from 'node:events';
import type { Readable } from 'node:stream';
import { type ChildProcess } from 'node:child_process';
import type { ShellOutputEvent } from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

// Hoisted Mocks
const mockPtySpawn = vi.hoisted(() => vi.fn());
const mockCpSpawn = vi.hoisted(() => vi.fn());
const mockIsBinary = vi.hoisted(() => vi.fn());
const mockPlatform = vi.hoisted(() => vi.fn());
const mockGetPty = vi.hoisted(() => vi.fn());
const mockSerializeTerminalToObject = vi.hoisted(() => vi.fn());

// Top-level Mocks
vi.mock('@lydell/node-pty', () => ({
  spawn: mockPtySpawn,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('node:child_process');
  return {
    ...actual,
    spawn: mockCpSpawn,
  };
});
vi.mock('../utils/textUtils.js', () => ({
  isBinary: mockIsBinary,
}));
vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    constants: {
      signals: {
        SIGTERM: 15,
        SIGKILL: 9,
      },
    },
  },
  platform: mockPlatform,
  constants: {
    signals: {
      SIGTERM: 15,
      SIGKILL: 9,
    },
  },
}));
vi.mock('../utils/getPty.js', () => ({
  getPty: mockGetPty,
}));
vi.mock('../utils/terminalSerializer.js', () => ({
  serializeTerminalToObject: mockSerializeTerminalToObject,
}));

const mockProcessKill = vi
  .spyOn(process, 'kill')
  .mockImplementation(() => true);

const shellExecutionConfig = {
  terminalWidth: 80,
  terminalHeight: 24,
  pager: 'cat',
  showColor: false,
  disableDynamicLineTrimming: true,
};

const createExpectedAnsiOutput = (text: string | string[]): AnsiOutput => {
  const lines = Array.isArray(text) ? text : text.split('\n');
  const expected: AnsiOutput = Array.from(
    { length: shellExecutionConfig.terminalHeight },
    (_, i) => [
      {
        text: expect.stringMatching((lines[i] || '').trim()),
        bold: false,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
        fg: '',
        bg: '',
      },
    ],
  );
  return expected;
};

describe('ShellExecutionService', () => {
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
    write: Mock;
    resize: Mock;
  };
  let mockHeadlessTerminal: {
    resize: Mock;
    scrollLines: Mock;
    buffer: {
      active: {
        viewportY: number;
      };
    };
  };
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsBinary.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    onOutputEventMock = vi.fn();

    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
      write: Mock;
      resize: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn();
    mockPtyProcess.onExit = vi.fn();
    mockPtyProcess.write = vi.fn();
    mockPtyProcess.resize = vi.fn();

    mockHeadlessTerminal = {
      resize: vi.fn(),
      scrollLines: vi.fn(),
      buffer: {
        active: {
          viewportY: 0,
        },
      },
    };

    mockPtySpawn.mockReturnValue(mockPtyProcess);
  });

  // Helper function to run a standard execution simulation
  const simulateExecution = async (
    command: string,
    simulation: (
      ptyProcess: typeof mockPtyProcess,
      ac: AbortController,
    ) => void | Promise<void>,
    config = shellExecutionConfig,
  ) => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      command,
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      config,
    );

    await new Promise((resolve) => process.nextTick(resolve));
    await simulation(mockPtyProcess, abortController);
    const result = await handle.result;
    return { result, handle, abortController };
  };

  describe('Successful Execution', () => {
    it('should execute a command and capture output', async () => {
      const { result, handle } = await simulateExecution('ls -l', (pty) => {
        pty.onData.mock.calls[0][0]('file1.txt\n');
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(mockPtySpawn).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ls -l'],
        expect.any(Object),
      );
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.error).toBeNull();
      expect(result.aborted).toBe(false);
      expect(result.output.trim()).toBe('file1.txt');
      expect(handle.pid).toBe(12345);

      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: createExpectedAnsiOutput('file1.txt'),
      });
    });

    it('should strip ANSI codes from output', async () => {
      const { result } = await simulateExecution('ls --color=auto', (pty) => {
        pty.onData.mock.calls[0][0]('a\u001b[31mred\u001b[0mword');
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(result.output.trim()).toBe('aredword');
      expect(onOutputEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data',
          chunk: createExpectedAnsiOutput('aredword'),
        }),
      );
    });

    it('should correctly decode multi-byte characters split across chunks', async () => {
      const { result } = await simulateExecution('echo "你好"', (pty) => {
        const multiByteChar = '你好';
        pty.onData.mock.calls[0][0](multiByteChar.slice(0, 1));
        pty.onData.mock.calls[0][0](multiByteChar.slice(1));
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });
      expect(result.output.trim()).toBe('你好');
    });

    it('should handle commands with no output', async () => {
      await simulateExecution('touch file', (pty) => {
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(onOutputEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          chunk: createExpectedAnsiOutput(''),
        }),
      );
    });

    it('should call onPid with the process id', async () => {
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'ls -l',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        shellExecutionConfig,
      );
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      await handle.result;
      expect(handle.pid).toBe(12345);
    });
  });

  describe('pty interaction', () => {
    beforeEach(() => {
      vi.spyOn(ShellExecutionService['activePtys'], 'get').mockReturnValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ptyProcess: mockPtyProcess as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headlessTerminal: mockHeadlessTerminal as any,
      });
    });

    it('should write to the pty and trigger a render', async () => {
      vi.useFakeTimers();
      await simulateExecution('interactive-app', (pty) => {
        ShellExecutionService.writeToPty(pty.pid!, 'input');
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(mockPtyProcess.write).toHaveBeenCalledWith('input');
      // Use fake timers to check for the delayed render
      await vi.advanceTimersByTimeAsync(17);
      // The render will cause an output event
      expect(onOutputEventMock).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should resize the pty and the headless terminal', async () => {
      await simulateExecution('ls -l', (pty) => {
        pty.onData.mock.calls[0][0]('file1.txt\n');
        ShellExecutionService.resizePty(pty.pid!, 100, 40);
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(mockPtyProcess.resize).toHaveBeenCalledWith(100, 40);
      expect(mockHeadlessTerminal.resize).toHaveBeenCalledWith(100, 40);
    });

    it('should scroll the headless terminal', async () => {
      await simulateExecution('ls -l', (pty) => {
        pty.onData.mock.calls[0][0]('file1.txt\n');
        ShellExecutionService.scrollPty(pty.pid!, 10);
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(mockHeadlessTerminal.scrollLines).toHaveBeenCalledWith(10);
    });
  });

  describe('Failed Execution', () => {
    it('should capture a non-zero exit code', async () => {
      const { result } = await simulateExecution('a-bad-command', (pty) => {
        pty.onData.mock.calls[0][0]('command not found');
        pty.onExit.mock.calls[0][0]({ exitCode: 127, signal: null });
      });

      expect(result.exitCode).toBe(127);
      expect(result.output.trim()).toBe('command not found');
      expect(result.error).toBeNull();
    });

    it('should capture a termination signal', async () => {
      const { result } = await simulateExecution('long-process', (pty) => {
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: 15 });
      });

      expect(result.exitCode).toBe(0);
      expect(result.signal).toBe(15);
    });

    it('should handle a synchronous spawn error', async () => {
      mockGetPty.mockImplementation(() => null);

      mockCpSpawn.mockImplementation(() => {
        throw new Error('Simulated PTY spawn error');
      });

      const handle = await ShellExecutionService.execute(
        'any-command',
        '/test/dir',
        onOutputEventMock,
        new AbortController().signal,
        true,
        {},
      );
      const result = await handle.result;

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain('Simulated PTY spawn error');
      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('');
      expect(handle.pid).toBeUndefined();
    });
  });

  describe('Aborting Commands', () => {
    it('should abort a running process and set the aborted flag', async () => {
      const { result } = await simulateExecution(
        'sleep 10',
        (pty, abortController) => {
          abortController.abort();
          pty.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
        },
      );

      expect(result.aborted).toBe(true);
      // The process kill is mocked, so we just check that the flag is set.
    });

    it('should send SIGTERM and then SIGKILL on abort', async () => {
      const sigkillPromise = new Promise<void>((resolve) => {
        mockProcessKill.mockImplementation((pid, signal) => {
          if (signal === 'SIGKILL' && pid === -mockPtyProcess.pid) {
            resolve();
          }
          return true;
        });
      });

      const { result } = await simulateExecution(
        'long-running-process',
        async (pty, abortController) => {
          abortController.abort();
          await sigkillPromise; // Wait for SIGKILL to be sent before exiting.
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: 9 });
        },
      );

      expect(result.aborted).toBe(true);

      // Verify the calls were made in the correct order.
      const killCalls = mockProcessKill.mock.calls;
      const sigtermCallIndex = killCalls.findIndex(
        (call) => call[0] === -mockPtyProcess.pid && call[1] === 'SIGTERM',
      );
      const sigkillCallIndex = killCalls.findIndex(
        (call) => call[0] === -mockPtyProcess.pid && call[1] === 'SIGKILL',
      );

      expect(sigtermCallIndex).toBe(0);
      expect(sigkillCallIndex).toBe(1);
      expect(sigtermCallIndex).toBeLessThan(sigkillCallIndex);

      expect(result.signal).toBe(9);
    });

    it('should resolve without waiting for the processing chain on abort', async () => {
      const { result } = await simulateExecution(
        'long-output',
        (pty, abortController) => {
          // Simulate a lot of data being in the queue to be processed
          for (let i = 0; i < 1000; i++) {
            pty.onData.mock.calls[0][0]('some data');
          }
          abortController.abort();
          pty.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
        },
      );

      // The main assertion here is implicit: the `await` for the result above
      // should complete without timing out. This proves that the resolution
      // was not blocked by the long chain of data processing promises,
      // which is the desired behavior on abort.
      expect(result.aborted).toBe(true);
    });
  });

  describe('Binary Output', () => {
    it('should detect binary output and switch to progress events', async () => {
      mockIsBinary.mockReturnValueOnce(true);
      const binaryChunk1 = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const binaryChunk2 = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);

      const { result } = await simulateExecution('cat image.png', (pty) => {
        pty.onData.mock.calls[0][0](binaryChunk1);
        pty.onData.mock.calls[0][0](binaryChunk2);
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(result.rawOutput).toEqual(
        Buffer.concat([binaryChunk1, binaryChunk2]),
      );
      expect(onOutputEventMock).toHaveBeenCalledTimes(3);
      expect(onOutputEventMock.mock.calls[0][0]).toEqual({
        type: 'binary_detected',
      });
      expect(onOutputEventMock.mock.calls[1][0]).toEqual({
        type: 'binary_progress',
        bytesReceived: 4,
      });
      expect(onOutputEventMock.mock.calls[2][0]).toEqual({
        type: 'binary_progress',
        bytesReceived: 8,
      });
    });

    it('should not emit data events after binary is detected', async () => {
      mockIsBinary.mockImplementation((buffer) => buffer.includes(0x00));

      await simulateExecution('cat mixed_file', (pty) => {
        pty.onData.mock.calls[0][0](Buffer.from([0x00, 0x01, 0x02]));
        pty.onData.mock.calls[0][0](Buffer.from('more text'));
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      const eventTypes = onOutputEventMock.mock.calls.map(
        (call: [ShellOutputEvent]) => call[0].type,
      );
      expect(eventTypes).toEqual([
        'binary_detected',
        'binary_progress',
        'binary_progress',
      ]);
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should use powershell.exe on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      await simulateExecution('dir "foo bar"', (pty) =>
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null }),
      );

      expect(mockPtySpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-Command', 'dir "foo bar"'],
        expect.any(Object),
      );
    });

    it('should use bash on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      await simulateExecution('ls "foo bar"', (pty) =>
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null }),
      );

      expect(mockPtySpawn).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ls "foo bar"'],
        expect.any(Object),
      );
    });
  });

  describe('AnsiOutput rendering', () => {
    it('should call onOutputEvent with AnsiOutput when showColor is true', async () => {
      const coloredShellExecutionConfig = {
        ...shellExecutionConfig,
        showColor: true,
        defaultFg: '#ffffff',
        defaultBg: '#000000',
        disableDynamicLineTrimming: true,
      };
      const mockAnsiOutput = [
        [{ text: 'hello', fg: '#ffffff', bg: '#000000' }],
      ];
      mockSerializeTerminalToObject.mockReturnValue(mockAnsiOutput);

      await simulateExecution(
        'ls --color=auto',
        (pty) => {
          pty.onData.mock.calls[0][0]('a\u001b[31mred\u001b[0mword');
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
        coloredShellExecutionConfig,
      );

      expect(mockSerializeTerminalToObject).toHaveBeenCalledWith(
        expect.anything(), // The terminal object
      );

      expect(onOutputEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data',
          chunk: mockAnsiOutput,
        }),
      );
    });

    it('should call onOutputEvent with AnsiOutput when showColor is false', async () => {
      await simulateExecution(
        'ls --color=auto',
        (pty) => {
          pty.onData.mock.calls[0][0]('a\u001b[31mred\u001b[0mword');
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
        {
          ...shellExecutionConfig,
          showColor: false,
          disableDynamicLineTrimming: true,
        },
      );

      const expected = createExpectedAnsiOutput('aredword');

      expect(onOutputEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data',
          chunk: expected,
        }),
      );
    });

    it('should handle multi-line output correctly when showColor is false', async () => {
      await simulateExecution(
        'ls --color=auto',
        (pty) => {
          pty.onData.mock.calls[0][0](
            'line 1\n\u001b[32mline 2\u001b[0m\nline 3',
          );
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
        {
          ...shellExecutionConfig,
          showColor: false,
          disableDynamicLineTrimming: true,
        },
      );

      const expected = createExpectedAnsiOutput(['line 1', 'line 2', 'line 3']);

      expect(onOutputEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data',
          chunk: expected,
        }),
      );
    });
  });
});

describe('ShellExecutionService child_process fallback', () => {
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsBinary.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
    mockGetPty.mockResolvedValue(null);

    onOutputEventMock = vi.fn();

    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();

    Object.defineProperty(mockChildProcess, 'pid', {
      value: 12345,
      configurable: true,
    });

    mockCpSpawn.mockReturnValue(mockChildProcess);
  });

  // Helper function to run a standard execution simulation
  const simulateExecution = async (
    command: string,
    simulation: (cp: typeof mockChildProcess, ac: AbortController) => void,
  ) => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      command,
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      shellExecutionConfig,
    );

    await new Promise((resolve) => process.nextTick(resolve));
    simulation(mockChildProcess, abortController);
    const result = await handle.result;
    return { result, handle, abortController };
  };

  describe('Successful Execution', () => {
    it('should execute a command and capture stdout and stderr', async () => {
      const { result, handle } = await simulateExecution('ls -l', (cp) => {
        cp.stdout?.emit('data', Buffer.from('file1.txt\n'));
        cp.stderr?.emit('data', Buffer.from('a warning'));
        cp.emit('exit', 0, null);
        cp.emit('close', 0, null);
      });

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ls -l'],
        expect.objectContaining({ shell: false, detached: true }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.error).toBeNull();
      expect(result.aborted).toBe(false);
      expect(result.output).toBe('file1.txt\na warning');
      expect(handle.pid).toBe(undefined);

      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: 'file1.txt\na warning',
      });
    });

    it('should strip ANSI codes from output', async () => {
      const { result } = await simulateExecution('ls --color=auto', (cp) => {
        cp.stdout?.emit('data', Buffer.from('a\u001b[31mred\u001b[0mword'));
        cp.emit('exit', 0, null);
        cp.emit('close', 0, null);
      });

      expect(result.output.trim()).toBe('aredword');
      expect(onOutputEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data',
          chunk: 'aredword',
        }),
      );
    });

    it('should correctly decode multi-byte characters split across chunks', async () => {
      const { result } = await simulateExecution('echo "你好"', (cp) => {
        const multiByteChar = Buffer.from('你好', 'utf-8');
        cp.stdout?.emit('data', multiByteChar.slice(0, 2));
        cp.stdout?.emit('data', multiByteChar.slice(2));
        cp.emit('exit', 0, null);
        cp.emit('close', 0, null);
      });
      expect(result.output.trim()).toBe('你好');
    });

    it('should handle commands with no output', async () => {
      const { result } = await simulateExecution('touch file', (cp) => {
        cp.emit('exit', 0, null);
        cp.emit('close', 0, null);
      });

      expect(result.output.trim()).toBe('');
      expect(onOutputEventMock).not.toHaveBeenCalled();
    });

    it('should truncate stdout using a sliding window and show a warning', async () => {
      const MAX_SIZE = 16 * 1024 * 1024;
      const chunk1 = 'a'.repeat(MAX_SIZE / 2 - 5);
      const chunk2 = 'b'.repeat(MAX_SIZE / 2 - 5);
      const chunk3 = 'c'.repeat(20);

      const { result } = await simulateExecution('large-output', (cp) => {
        cp.stdout?.emit('data', Buffer.from(chunk1));
        cp.stdout?.emit('data', Buffer.from(chunk2));
        cp.stdout?.emit('data', Buffer.from(chunk3));
        cp.emit('exit', 0, null);
      });

      const truncationMessage =
        '[GEMINI_CLI_WARNING: Output truncated. The buffer is limited to 16MB.]';
      expect(result.output).toContain(truncationMessage);

      const outputWithoutMessage = result.output
        .substring(0, result.output.indexOf(truncationMessage))
        .trimEnd();

      expect(outputWithoutMessage.length).toBe(MAX_SIZE);

      const expectedStart = (chunk1 + chunk2 + chunk3).slice(-MAX_SIZE);
      expect(
        outputWithoutMessage.startsWith(expectedStart.substring(0, 10)),
      ).toBe(true);
      expect(outputWithoutMessage.endsWith('c'.repeat(20))).toBe(true);
    }, 20000);
  });

  describe('Failed Execution', () => {
    it('should capture a non-zero exit code and format output correctly', async () => {
      const { result } = await simulateExecution('a-bad-command', (cp) => {
        cp.stderr?.emit('data', Buffer.from('command not found'));
        cp.emit('exit', 127, null);
        cp.emit('close', 127, null);
      });

      expect(result.exitCode).toBe(127);
      expect(result.output.trim()).toBe('command not found');
      expect(result.error).toBeNull();
    });

    it('should capture a termination signal', async () => {
      const { result } = await simulateExecution('long-process', (cp) => {
        cp.emit('exit', null, 'SIGTERM');
        cp.emit('close', null, 'SIGTERM');
      });

      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe(15);
    });

    it('should handle a spawn error', async () => {
      const spawnError = new Error('spawn EACCES');
      const { result } = await simulateExecution('protected-cmd', (cp) => {
        cp.emit('error', spawnError);
        cp.emit('exit', 1, null);
        cp.emit('close', 1, null);
      });

      expect(result.error).toBe(spawnError);
      expect(result.exitCode).toBe(1);
    });

    it('handles errors that do not fire the exit event', async () => {
      const error = new Error('spawn abc ENOENT');
      const { result } = await simulateExecution('touch cat.jpg', (cp) => {
        cp.emit('error', error); // No exit event is fired.
        cp.emit('close', 1, null);
      });

      expect(result.error).toBe(error);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Aborting Commands', () => {
    describe.each([
      {
        platform: 'linux',
        expectedSignal: 'SIGTERM',
        expectedExit: { signal: 'SIGKILL' as const },
      },
      {
        platform: 'win32',
        expectedCommand: 'taskkill',
        expectedExit: { code: 1 },
      },
    ])(
      'on $platform',
      ({ platform, expectedSignal, expectedCommand, expectedExit }) => {
        it('should abort a running process and set the aborted flag', async () => {
          mockPlatform.mockReturnValue(platform);

          const { result } = await simulateExecution(
            'sleep 10',
            (cp, abortController) => {
              abortController.abort();
              if (expectedExit.signal) {
                cp.emit('exit', null, expectedExit.signal);
                cp.emit('close', null, expectedExit.signal);
              }
              if (typeof expectedExit.code === 'number') {
                cp.emit('exit', expectedExit.code, null);
                cp.emit('close', expectedExit.code, null);
              }
            },
          );

          expect(result.aborted).toBe(true);

          if (platform === 'linux') {
            expect(mockProcessKill).toHaveBeenCalledWith(
              -mockChildProcess.pid!,
              expectedSignal,
            );
          } else {
            expect(mockCpSpawn).toHaveBeenCalledWith(expectedCommand, [
              '/pid',
              String(mockChildProcess.pid),
              '/f',
              '/t',
            ]);
          }
        });
      },
    );

    it('should gracefully attempt SIGKILL on linux if SIGTERM fails', async () => {
      mockPlatform.mockReturnValue('linux');
      vi.useFakeTimers();

      // Don't await the result inside the simulation block for this specific test.
      // We need to control the timeline manually.
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'unresponsive_process',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        {},
      );

      abortController.abort();

      // Check the first kill signal
      expect(mockProcessKill).toHaveBeenCalledWith(
        -mockChildProcess.pid!,
        'SIGTERM',
      );

      // Now, advance time past the timeout
      await vi.advanceTimersByTimeAsync(250);

      // Check the second kill signal
      expect(mockProcessKill).toHaveBeenCalledWith(
        -mockChildProcess.pid!,
        'SIGKILL',
      );

      // Finally, simulate the process exiting and await the result
      mockChildProcess.emit('exit', null, 'SIGKILL');
      mockChildProcess.emit('close', null, 'SIGKILL');
      const result = await handle.result;

      vi.useRealTimers();

      expect(result.aborted).toBe(true);
      expect(result.signal).toBe(9);
    });
  });

  describe('Binary Output', () => {
    it('should detect binary output and switch to progress events', async () => {
      mockIsBinary.mockReturnValueOnce(true);
      const binaryChunk1 = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const binaryChunk2 = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);

      const { result } = await simulateExecution('cat image.png', (cp) => {
        cp.stdout?.emit('data', binaryChunk1);
        cp.stdout?.emit('data', binaryChunk2);
        cp.emit('exit', 0, null);
      });

      expect(result.rawOutput).toEqual(
        Buffer.concat([binaryChunk1, binaryChunk2]),
      );
      expect(onOutputEventMock).toHaveBeenCalledTimes(1);
      expect(onOutputEventMock.mock.calls[0][0]).toEqual({
        type: 'binary_detected',
      });
    });

    it('should not emit data events after binary is detected', async () => {
      mockIsBinary.mockImplementation((buffer) => buffer.includes(0x00));

      await simulateExecution('cat mixed_file', (cp) => {
        cp.stdout?.emit('data', Buffer.from('some text'));
        cp.stdout?.emit('data', Buffer.from([0x00, 0x01, 0x02]));
        cp.stdout?.emit('data', Buffer.from('more text'));
        cp.emit('exit', 0, null);
      });

      const eventTypes = onOutputEventMock.mock.calls.map(
        (call: [ShellOutputEvent]) => call[0].type,
      );
      expect(eventTypes).toEqual(['binary_detected']);
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should use powershell.exe on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      await simulateExecution('dir "foo bar"', (cp) =>
        cp.emit('exit', 0, null),
      );

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-Command', 'dir "foo bar"'],
        expect.objectContaining({
          shell: false,
          detached: false,
          windowsVerbatimArguments: false,
        }),
      );
    });

    it('should use bash and detached process group on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      await simulateExecution('ls "foo bar"', (cp) => cp.emit('exit', 0, null));

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ls "foo bar"'],
        expect.objectContaining({
          shell: false,
          detached: true,
        }),
      );
    });
  });
});

describe('ShellExecutionService execution method selection', () => {
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
    write: Mock;
    resize: Mock;
  };
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    onOutputEventMock = vi.fn();

    // Mock for pty
    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
      write: Mock;
      resize: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn();
    mockPtyProcess.onExit = vi.fn();
    mockPtyProcess.write = vi.fn();
    mockPtyProcess.resize = vi.fn();

    mockPtySpawn.mockReturnValue(mockPtyProcess);
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    // Mock for child_process
    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();
    Object.defineProperty(mockChildProcess, 'pid', {
      value: 54321,
      configurable: true,
    });
    mockCpSpawn.mockReturnValue(mockChildProcess);
  });

  it('should use node-pty when shouldUseNodePty is true and pty is available', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // shouldUseNodePty
      shellExecutionConfig,
    );

    // Simulate exit to allow promise to resolve
    mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
    const result = await handle.result;

    expect(mockGetPty).toHaveBeenCalled();
    expect(mockPtySpawn).toHaveBeenCalled();
    expect(mockCpSpawn).not.toHaveBeenCalled();
    expect(result.executionMethod).toBe('mock-pty');
  });

  it('should use child_process when shouldUseNodePty is false', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      false, // shouldUseNodePty
      {},
    );

    // Simulate exit to allow promise to resolve
    mockChildProcess.emit('exit', 0, null);
    const result = await handle.result;

    expect(mockGetPty).not.toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockCpSpawn).toHaveBeenCalled();
    expect(result.executionMethod).toBe('child_process');
  });

  it('should fall back to child_process if pty is not available even if shouldUseNodePty is true', async () => {
    mockGetPty.mockResolvedValue(null);

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // shouldUseNodePty
      shellExecutionConfig,
    );

    // Simulate exit to allow promise to resolve
    mockChildProcess.emit('exit', 0, null);
    const result = await handle.result;

    expect(mockGetPty).toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockCpSpawn).toHaveBeenCalled();
    expect(result.executionMethod).toBe('child_process');
  });
});
