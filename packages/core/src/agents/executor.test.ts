/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedClass,
} from 'vitest';
import { AgentExecutor, type ActivityCallback } from './executor.js';
import type {
  AgentDefinition,
  AgentInputs,
  SubagentActivityEvent,
} from './types.js';
import { AgentTerminateMode } from './types.js';
import { makeFakeConfig } from '../test-utils/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import {
  GeminiChat,
  StreamEventType,
  type StreamEvent,
} from '../core/geminiChat.js';
import {
  Type,
  type FunctionCall,
  type Part,
  type GenerateContentResponse,
} from '@google/genai';
import type { Config } from '../config/config.js';
import { MockTool } from '../test-utils/mock-tool.js';
import { getDirectoryContextString } from '../utils/environmentContext.js';

const { mockSendMessageStream, mockExecuteToolCall } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockExecuteToolCall: vi.fn(),
}));

vi.mock('../core/geminiChat.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    GeminiChat: vi.fn().mockImplementation(() => ({
      sendMessageStream: mockSendMessageStream,
    })),
  };
});

vi.mock('../core/nonInteractiveToolExecutor.js', () => ({
  executeToolCall: mockExecuteToolCall,
}));

vi.mock('../utils/environmentContext.js');

const MockedGeminiChat = GeminiChat as MockedClass<typeof GeminiChat>;

// A mock tool that is NOT on the NON_INTERACTIVE_TOOL_ALLOWLIST
const MOCK_TOOL_NOT_ALLOWED = new MockTool({ name: 'write_file' });

const createMockResponseChunk = (
  parts: Part[],
  functionCalls?: FunctionCall[],
): GenerateContentResponse =>
  ({
    candidates: [{ index: 0, content: { role: 'model', parts } }],
    functionCalls,
  }) as unknown as GenerateContentResponse;

const mockModelResponse = (
  functionCalls: FunctionCall[],
  thought?: string,
  text?: string,
) => {
  const parts: Part[] = [];
  if (thought) {
    parts.push({
      text: `**${thought}** This is the reasoning part.`,
      thought: true,
    });
  }
  if (text) parts.push({ text });

  const responseChunk = createMockResponseChunk(
    parts,
    // Ensure functionCalls is undefined if the array is empty, matching API behavior
    functionCalls.length > 0 ? functionCalls : undefined,
  );

  mockSendMessageStream.mockImplementationOnce(async () =>
    (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: responseChunk,
      } as StreamEvent;
    })(),
  );
};

let mockConfig: Config;
let parentToolRegistry: ToolRegistry;

const createTestDefinition = (
  tools: Array<string | MockTool> = [LSTool.Name],
  runConfigOverrides: Partial<AgentDefinition['runConfig']> = {},
  outputConfigOverrides: Partial<AgentDefinition['outputConfig']> = {},
): AgentDefinition => ({
  name: 'TestAgent',
  description: 'An agent for testing.',
  inputConfig: {
    inputs: { goal: { type: 'string', required: true, description: 'goal' } },
  },
  modelConfig: { model: 'gemini-test-model', temp: 0, top_p: 1 },
  runConfig: { max_time_minutes: 5, max_turns: 5, ...runConfigOverrides },
  promptConfig: { systemPrompt: 'Achieve the goal: ${goal}.' },
  toolConfig: { tools },
  outputConfig: {
    outputName: 'finalResult',
    description: 'The final result.',
    schema: { type: Type.STRING },
    ...outputConfigOverrides,
  },
});

describe('AgentExecutor', () => {
  let activities: SubagentActivityEvent[];
  let onActivity: ActivityCallback;
  let abortController: AbortController;
  let signal: AbortSignal;

  beforeEach(async () => {
    mockSendMessageStream.mockReset();
    mockExecuteToolCall.mockReset();
    vi.resetAllMocks();

    // Restore the GeminiChat constructor mock
    MockedGeminiChat.mockImplementation(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
        }) as unknown as GeminiChat,
    );

    // Use fake timers for timeout and concurrency testing
    vi.useFakeTimers();

    mockConfig = makeFakeConfig();
    parentToolRegistry = new ToolRegistry(mockConfig);
    parentToolRegistry.registerTool(new LSTool(mockConfig));
    parentToolRegistry.registerTool(new ReadFileTool(mockConfig));
    parentToolRegistry.registerTool(MOCK_TOOL_NOT_ALLOWED);

    vi.spyOn(mockConfig, 'getToolRegistry').mockResolvedValue(
      parentToolRegistry,
    );

    vi.mocked(getDirectoryContextString).mockResolvedValue(
      'Mocked Environment Context',
    );

    activities = [];
    onActivity = (activity) => activities.push(activity);
    abortController = new AbortController();
    signal = abortController.signal;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create (Initialization and Validation)', () => {
    it('should create successfully with allowed tools', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );
      expect(executor).toBeInstanceOf(AgentExecutor);
    });

    it('SECURITY: should throw if a tool is not on the non-interactive allowlist', async () => {
      const definition = createTestDefinition([MOCK_TOOL_NOT_ALLOWED.name]);
      await expect(
        AgentExecutor.create(definition, mockConfig, onActivity),
      ).rejects.toThrow(
        `Tool "${MOCK_TOOL_NOT_ALLOWED.name}" is not on the allow-list for non-interactive execution`,
      );
    });

    it('should create an isolated ToolRegistry for the agent', async () => {
      const definition = createTestDefinition([LSTool.Name, ReadFileTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );
      // @ts-expect-error - accessing private property for test validation
      const agentRegistry = executor.toolRegistry as ToolRegistry;

      expect(agentRegistry).not.toBe(parentToolRegistry);
      expect(agentRegistry.getAllToolNames()).toEqual(
        expect.arrayContaining([LSTool.Name, ReadFileTool.Name]),
      );
      expect(agentRegistry.getAllToolNames()).toHaveLength(2);
      expect(agentRegistry.getTool(MOCK_TOOL_NOT_ALLOWED.name)).toBeUndefined();
    });
  });

  describe('run (Execution Loop and Logic)', () => {
    it('should execute successfully when model calls submit_final_output (Happy Path)', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );
      const inputs: AgentInputs = { goal: 'Find files' };

      // Turn 1: Model calls ls
      mockModelResponse(
        [{ name: LSTool.Name, args: { path: '.' }, id: 'call1' }],
        'T1: Listing',
      );
      mockExecuteToolCall.mockResolvedValueOnce({
        callId: 'call1',
        resultDisplay: 'file1.txt',
        responseParts: [
          {
            functionResponse: {
              name: LSTool.Name,
              response: { result: 'file1.txt' },
              id: 'call1',
            },
          },
        ],
        error: undefined,
      });

      // Turn 2: Model calls submit_final_output
      mockModelResponse(
        [
          {
            name: 'submit_final_output',
            args: { finalResult: 'Found file1.txt' },
            id: 'call2',
          },
        ],
        'T2: Done',
      );

      const output = await executor.run(inputs, signal);

      // Should have called the model twice
      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
      // Should have executed only the 'ls' tool call externally
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: LSTool.Name }),
        expect.anything(),
      );

      // Verify System Prompt contains the new instructions
      const chatConstructorArgs = MockedGeminiChat.mock.calls[0];
      const chatConfig = chatConstructorArgs[1];
      expect(chatConfig?.systemInstruction).toContain(
        'Achieve the goal: Find files.',
      );
      expect(chatConfig?.systemInstruction).toContain(
        'MUST call the `submit_final_output` tool',
      );

      // Verify the tools list passed to the model includes submit_final_output
      const turn1CallArgs = mockSendMessageStream.mock.calls[0];
      const turn1Config = turn1CallArgs[1].config;
      const tools = turn1Config.tools[0].functionDeclarations;
      expect(tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: LSTool.Name }),
          expect.objectContaining({ name: 'submit_final_output' }),
        ]),
      );

      expect(output.result).toBe('Found file1.txt');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

      // Verify Activity Stream
      expect(activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'THOUGHT_CHUNK',
            data: { text: 'T1: Listing' },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_START',
            data: { name: LSTool.Name, args: { path: '.' } },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_END',
            data: { name: LSTool.Name, output: 'file1.txt' },
          }),
          expect.objectContaining({
            type: 'THOUGHT_CHUNK',
            data: { text: 'T2: Done' },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_START',
            data: {
              name: 'submit_final_output',
              args: { finalResult: 'Found file1.txt' },
            },
          }),
          expect.objectContaining({
            type: 'TOOL_CALL_END',
            data: {
              name: 'submit_final_output',
              output: 'Output submitted successfully.',
            },
          }),
        ]),
      );
    });

    it('should nudge the model if it stops without calling submit_final_output', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1: Model calls ls
      mockModelResponse([
        { name: LSTool.Name, args: { path: '.' }, id: 'call1' },
      ]);
      mockExecuteToolCall.mockResolvedValueOnce({
        callId: 'call1',
        resultDisplay: 'ok',
        responseParts: [
          {
            functionResponse: { name: LSTool.Name, response: {}, id: 'call1' },
          },
        ],
      });

      // Turn 2: Model stops calling tools (prematurely)
      mockModelResponse([]);

      // Turn 3: Model responds to the nudge by calling submit_final_output
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: { finalResult: 'Done after nudge' },
          id: 'call2',
        },
      ]);

      const output = await executor.run({ goal: 'Nudge test' }, signal);

      expect(mockSendMessageStream).toHaveBeenCalledTimes(3);

      // Verify the nudge message was sent in the 3rd call
      const turn3CallArgs = mockSendMessageStream.mock.calls[2];
      const turn3Message = turn3CallArgs[1].message as Part[];
      expect(turn3Message[0].text).toContain(
        'You have stopped calling tools, but you have not called `submit_final_output`',
      );

      expect(output.result).toBe('Done after nudge');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    });

    it('should report an error if submit_final_output is called with missing arguments', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1: Model calls submit_final_output but forgets the argument
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: {}, // Missing 'finalResult'
          id: 'call1',
        },
      ]);

      // Turn 2: Model corrects itself
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: { finalResult: 'Corrected result' },
          id: 'call2',
        },
      ]);

      const output = await executor.run({ goal: 'Error test' }, signal);

      expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

      // Verify the error was reported in the activity stream
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'ERROR',
          data: {
            context: 'tool_call',
            name: 'submit_final_output',
            error: "Missing required argument 'finalResult'.",
          },
        }),
      );

      // Verify the error was sent back to the model in the 2nd call
      const turn2CallArgs = mockSendMessageStream.mock.calls[1];
      const turn2Message = turn2CallArgs[1].message as Part[];
      expect(turn2Message[0]).toEqual(
        expect.objectContaining({
          functionResponse: expect.objectContaining({
            name: 'submit_final_output',
            response: { error: "Missing required argument 'finalResult'." },
          }),
        }),
      );

      expect(output.result).toBe('Corrected result');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);
    });

    it('should execute parallel tool calls concurrently', async () => {
      const definition = createTestDefinition([LSTool.Name, ReadFileTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      const call1 = {
        name: LSTool.Name,
        args: { path: '/dir1' },
        id: 'call1',
      };
      // Using LSTool twice for simplicity in mocking standardized responses.
      const call2 = {
        name: LSTool.Name,
        args: { path: '/dir2' },
        id: 'call2',
      };

      // Turn 1: Model calls two tools simultaneously
      mockModelResponse([call1, call2], 'T1: Listing both');

      // Use concurrency tracking to ensure parallelism
      let activeCalls = 0;
      let maxActiveCalls = 0;
      let callsStarted = 0;
      let resolveCallsStarted: () => void;
      const callsStartedPromise = new Promise<void>((resolve) => {
        resolveCallsStarted = resolve;
      });

      mockExecuteToolCall.mockImplementation(async (_ctx, reqInfo) => {
        activeCalls++;
        callsStarted++;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        if (callsStarted === 2) {
          resolveCallsStarted();
        }

        // Simulate latency. We must advance the fake timers for this to resolve.
        await new Promise((resolve) => setTimeout(resolve, 100));
        activeCalls--;
        return {
          callId: reqInfo.callId,
          resultDisplay: `Result for ${reqInfo.name}`,
          responseParts: [
            {
              functionResponse: {
                name: reqInfo.name,
                response: {},
                id: reqInfo.callId,
              },
            },
          ],
          error: undefined,
        };
      });

      // Turn 2: Model submits output
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: { finalResult: 'Done.' },
          id: 'call3',
        },
      ]);

      const runPromise = executor.run({ goal: 'Parallel test' }, signal);

      // Kickstart the async process
      await vi.advanceTimersByTimeAsync(1);

      // Wait until both calls have started
      await callsStartedPromise;

      // Advance timers while the parallel calls (Promise.all + setTimeout) are running
      await vi.advanceTimersByTimeAsync(150);

      await runPromise;

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(2);

      // Verify the input to the next model call (Turn 2) contains both responses
      const turn2Input = mockSendMessageStream.mock.calls[1][1];
      const turn2Parts = turn2Input.message as Part[];

      // Promise.all preserves the order of the input array.
      expect(turn2Parts.length).toBe(2);
      expect(turn2Parts[0]).toEqual(
        expect.objectContaining({
          functionResponse: expect.objectContaining({ id: 'call1' }),
        }),
      );
      expect(turn2Parts[1]).toEqual(
        expect.objectContaining({
          functionResponse: expect.objectContaining({ id: 'call2' }),
        }),
      );
    });

    it('should handle tool execution failure gracefully and report error', async () => {
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1: Model calls ls, but it fails
      mockModelResponse([
        { name: LSTool.Name, args: { path: '/invalid' }, id: 'call1' },
      ]);

      const errorMessage = 'Internal failure.';
      mockExecuteToolCall.mockResolvedValueOnce({
        callId: 'call1',
        resultDisplay: `Error: ${errorMessage}`,
        responseParts: undefined, // Failed tools might return undefined parts
        error: { message: errorMessage },
      });

      // Turn 2: Model submits output
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: { finalResult: 'Failed.' },
          id: 'call2',
        },
      ]);

      await executor.run({ goal: 'Failure test' }, signal);

      // Verify that the error was reported in the activity stream
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'ERROR',
          data: {
            error: errorMessage,
            context: 'tool_call',
            name: LSTool.Name,
          },
        }),
      );

      // Verify the input to the next model call (Turn 2) contains the fallback error message
      const turn2Input = mockSendMessageStream.mock.calls[1][1];
      const turn2Parts = turn2Input.message as Part[];
      expect(turn2Parts).toEqual([
        {
          text: 'All tool calls failed or were unauthorized. Please analyze the errors and try an alternative approach.',
        },
      ]);
    });

    it('SECURITY: should block calls to tools not registered for the agent at runtime', async () => {
      // Agent definition only includes LSTool
      const definition = createTestDefinition([LSTool.Name]);
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1: Model hallucinates a call to ReadFileTool
      // (ReadFileTool exists in the parent registry but not the agent's isolated registry)
      mockModelResponse([
        {
          name: ReadFileTool.Name,
          args: { path: 'config.txt' },
          id: 'call_blocked',
        },
      ]);

      // Turn 2: Model submits output
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: { finalResult: 'Done.' },
          id: 'call2',
        },
      ]);

      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await executor.run({ goal: 'Security test' }, signal);

      // Verify executeToolCall was NEVER called because the tool was unauthorized
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `attempted to call unauthorized tool '${ReadFileTool.Name}'`,
        ),
      );

      consoleWarnSpy.mockRestore();

      // Verify the input to the next model call (Turn 2) indicates failure (as the only call was blocked)
      const turn2Input = mockSendMessageStream.mock.calls[1][1];
      const turn2Parts = turn2Input.message as Part[];
      expect(turn2Parts[0].text).toContain('All tool calls failed');
    });

    it('should handle multiple calls to submit_final_output in the same turn by accepting the first and erroring on the rest', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1: Model calls submit_final_output TWICE
      mockModelResponse([
        {
          name: 'submit_final_output',
          args: { finalResult: 'First result' },
          id: 'call1',
        },
        {
          name: 'submit_final_output',
          args: { finalResult: 'Second result (should be ignored)' },
          id: 'call2',
        },
      ]);

      const output = await executor.run(
        { goal: 'Multiple submit test' },
        signal,
      );

      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

      // Verify the result matches the FIRST call
      expect(output.result).toBe('First result');
      expect(output.terminate_reason).toBe(AgentTerminateMode.GOAL);

      // Verify activities
      // 1. TOOL_CALL_START for both
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'TOOL_CALL_START',
          data: expect.objectContaining({
            name: 'submit_final_output',
            args: { finalResult: 'First result' },
          }),
        }),
      );
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'TOOL_CALL_START',
          data: expect.objectContaining({
            name: 'submit_final_output',
            args: { finalResult: 'Second result (should be ignored)' },
          }),
        }),
      );

      // 2. TOOL_CALL_END for the first one
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'TOOL_CALL_END',
          data: {
            name: 'submit_final_output',
            output: 'Output submitted successfully.',
          },
        }),
      );

      // 3. ERROR for the second one
      expect(activities).toContainEqual(
        expect.objectContaining({
          type: 'ERROR',
          data: {
            context: 'tool_call',
            name: 'submit_final_output',
            error:
              'Final output has already been submitted in this turn. Ignoring duplicate call.',
          },
        }),
      );
    });
  });

  describe('run (Termination Conditions)', () => {
    const mockKeepAliveResponse = () => {
      mockModelResponse(
        [{ name: LSTool.Name, args: { path: '.' }, id: 'loop' }],
        'Looping',
      );
      mockExecuteToolCall.mockResolvedValue({
        callId: 'loop',
        resultDisplay: 'ok',
        responseParts: [
          { functionResponse: { name: LSTool.Name, response: {}, id: 'loop' } },
        ],
        error: undefined,
      });
    };

    it('should terminate when max_turns is reached', async () => {
      const MAX_TURNS = 2;
      const definition = createTestDefinition([LSTool.Name], {
        max_turns: MAX_TURNS,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1
      mockKeepAliveResponse();
      // Turn 2
      mockKeepAliveResponse();

      const output = await executor.run({ goal: 'Termination test' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.MAX_TURNS);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(MAX_TURNS);
    });

    it('should terminate if timeout is reached', async () => {
      const definition = createTestDefinition([LSTool.Name], {
        max_time_minutes: 5,
        max_turns: 100,
      });
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Turn 1 setup
      mockModelResponse(
        [{ name: LSTool.Name, args: { path: '.' }, id: 'loop' }],
        'Looping',
      );

      // Mock a tool call that takes a long time, causing the overall timeout
      mockExecuteToolCall.mockImplementation(async () => {
        // Advance time past the 5-minute limit during the tool call execution
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
        return {
          callId: 'loop',
          resultDisplay: 'ok',
          responseParts: [
            {
              functionResponse: { name: LSTool.Name, response: {}, id: 'loop' },
            },
          ],
          error: undefined,
        };
      });

      const output = await executor.run({ goal: 'Termination test' }, signal);

      expect(output.terminate_reason).toBe(AgentTerminateMode.TIMEOUT);
      // Should only have called the model once before the timeout check stopped it
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('should terminate when AbortSignal is triggered mid-stream', async () => {
      const definition = createTestDefinition();
      const executor = await AgentExecutor.create(
        definition,
        mockConfig,
        onActivity,
      );

      // Mock the model response stream
      mockSendMessageStream.mockImplementation(async () =>
        (async function* () {
          // Yield the first chunk
          yield {
            type: StreamEventType.CHUNK,
            value: createMockResponseChunk([
              { text: '**Thinking** Step 1', thought: true },
            ]),
          } as StreamEvent;

          // Simulate abort happening mid-stream
          abortController.abort();
          // The loop in callModel should break immediately due to signal check.
        })(),
      );

      const output = await executor.run({ goal: 'Termination test' }, signal);
      expect(output.terminate_reason).toBe(AgentTerminateMode.ABORTED);
    });
  });
});
