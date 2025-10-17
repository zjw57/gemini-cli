/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Mock, MockInstance } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGeminiStream } from './useGeminiStream.js';
import { useKeypress } from './useKeypress.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import type {
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedExecutingToolCall,
  TrackedCancelledToolCall,
  TrackedWaitingToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  GeminiClient,
  AnyToolInvocation,
} from '@google/gemini-cli-core';
import {
  ApprovalMode,
  AuthType,
  GeminiEventType as ServerGeminiEventType,
  ToolErrorType,
  ToolConfirmationOutcome,
  tokenLimit,
} from '@google/gemini-cli-core';
import type { Part, PartListUnion } from '@google/genai';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { HistoryItem, SlashCommandProcessorResult } from '../types.js';
import { MessageType, StreamingState } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const mockSendMessageStream = vi
  .fn()
  .mockReturnValue((async function* () {})());
const mockStartChat = vi.fn();

const MockedGeminiClientClass = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: any, _config: any) {
    // _config
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
    this.getChat = vi.fn().mockReturnValue({
      recordCompletedToolCalls: vi.fn(),
    });
    this.getChatRecordingService = vi.fn().mockReturnValue({
      recordThought: vi.fn(),
      initialize: vi.fn(),
      recordMessage: vi.fn(),
      recordMessageTokens: vi.fn(),
      recordToolCalls: vi.fn(),
      getConversationFile: vi.fn(),
    });
  }),
);

const MockedUserPromptEvent = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {}),
);
const mockParseAndFormatApiError = vi.hoisted(() => vi.fn());

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actualCoreModule = (await importOriginal()) as any;
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    GeminiClient: MockedGeminiClientClass,
    UserPromptEvent: MockedUserPromptEvent,
    parseAndFormatApiError: mockParseAndFormatApiError,
    tokenLimit: vi.fn().mockReturnValue(100), // Mock tokenLimit
  };
});

const mockUseReactToolScheduler = useReactToolScheduler as Mock;
vi.mock('./useReactToolScheduler.js', async (importOriginal) => {
  const actualSchedulerModule = (await importOriginal()) as any;
  return {
    ...(actualSchedulerModule || {}),
    useReactToolScheduler: vi.fn(),
  };
});

vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: vi.fn().mockReturnValue({
    handleShellCommand: vi.fn(),
  }),
}));

vi.mock('./atCommandProcessor.js');

vi.mock('../utils/markdownUtilities.js', () => ({
  findLastSafeSplitPoint: vi.fn((s: string) => s.length),
}));

vi.mock('./useStateAndRef.js', () => ({
  useStateAndRef: vi.fn((initial) => {
    let val = initial;
    const ref = { current: val };
    const setVal = vi.fn((updater) => {
      if (typeof updater === 'function') {
        val = updater(val);
      } else {
        val = updater;
      }
      ref.current = val;
    });
    return [val, ref, setVal];
  }),
}));

vi.mock('./useLogger.js', () => ({
  useLogger: vi.fn().mockReturnValue({
    logMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockStartNewPrompt = vi.fn();
const mockAddUsage = vi.fn();
vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    startNewPrompt: mockStartNewPrompt,
    addUsage: mockAddUsage,
    getPromptCount: vi.fn(() => 5),
  })),
}));

vi.mock('./slashCommandProcessor.js', () => ({
  handleSlashCommand: vi.fn().mockReturnValue(false),
}));

// --- END MOCKS ---

// --- Tests for useGeminiStream Hook ---
describe('useGeminiStream', () => {
  let mockAddItem: Mock;
  let mockConfig: Config;
  let mockOnDebugMessage: Mock;
  let mockHandleSlashCommand: Mock;
  let mockScheduleToolCalls: Mock;
  let mockCancelAllToolCalls: Mock;
  let mockMarkToolsAsSubmitted: Mock;
  let handleAtCommandSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test

    mockAddItem = vi.fn();
    // Define the mock for getGeminiClient
    const mockGetGeminiClient = vi.fn().mockImplementation(() => {
      // MockedGeminiClientClass is defined in the module scope by the previous change.
      // It will use the mockStartChat and mockSendMessageStream that are managed within beforeEach.
      const clientInstance = new MockedGeminiClientClass(mockConfig);
      return clientInstance;
    });

    const contentGeneratorConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      vertexai: false,
      authType: AuthType.USE_GEMINI,
    };

    mockConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-pro',
      sandbox: false,
      targetDir: '/test/dir',
      debugMode: false,
      question: undefined,

      coreTools: [],
      toolDiscoveryCommand: undefined,
      toolCallCommand: undefined,
      mcpServerCommand: undefined,
      mcpServers: undefined,
      userAgent: 'test-agent',
      userMemory: '',
      geminiMdFileCount: 0,
      alwaysSkipModificationConfirmation: false,
      vertexai: false,
      showMemoryUsage: false,
      contextFileName: undefined,
      getToolRegistry: vi.fn(
        () => ({ getToolSchemaList: vi.fn(() => []) }) as any,
      ),
      getProjectRoot: vi.fn(() => '/test/dir'),
      getCheckpointingEnabled: vi.fn(() => false),
      getGeminiClient: mockGetGeminiClient,
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      addHistory: vi.fn(),
      getSessionId() {
        return 'test-session-id';
      },
      setQuotaErrorOccurred: vi.fn(),
      getQuotaErrorOccurred: vi.fn(() => false),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
    } as unknown as Config;
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);

    // Mock return value for useReactToolScheduler
    mockScheduleToolCalls = vi.fn();
    mockCancelAllToolCalls = vi.fn();
    mockMarkToolsAsSubmitted = vi.fn();

    // Default mock for useReactToolScheduler to prevent toolCalls being undefined initially
    mockUseReactToolScheduler.mockReturnValue([
      [], // Default to empty array for toolCalls
      mockScheduleToolCalls,
      mockCancelAllToolCalls,
      mockMarkToolsAsSubmitted,
    ]);

    // Reset mocks for GeminiClient instance methods (startChat and sendMessageStream)
    // The GeminiClient constructor itself is mocked at the module level.
    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as any); // GeminiChat -> any
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
    handleAtCommandSpy = vi.spyOn(atCommandProcessor, 'handleAtCommand');
  });

  const mockLoadedSettings: LoadedSettings = {
    merged: { preferredEditor: 'vscode' },
    user: { path: '/user/settings.json', settings: {} },
    workspace: { path: '/workspace/.gemini/settings.json', settings: {} },
    errors: [],
    forScope: vi.fn(),
    setValue: vi.fn(),
  } as unknown as LoadedSettings;

  const renderTestHook = (
    initialToolCalls: TrackedToolCall[] = [],
    geminiClient?: any,
  ) => {
    let currentToolCalls = initialToolCalls;
    const setToolCalls = (newToolCalls: TrackedToolCall[]) => {
      currentToolCalls = newToolCalls;
    };

    mockUseReactToolScheduler.mockImplementation(() => [
      currentToolCalls,
      mockScheduleToolCalls,
      mockCancelAllToolCalls,
      mockMarkToolsAsSubmitted,
    ]);

    const client = geminiClient || mockConfig.getGeminiClient();

    const { result, rerender } = renderHook(
      (props: {
        client: any;
        history: HistoryItem[];
        addItem: UseHistoryManagerReturn['addItem'];
        config: Config;
        onDebugMessage: (message: string) => void;
        handleSlashCommand: (
          cmd: PartListUnion,
        ) => Promise<SlashCommandProcessorResult | false>;
        shellModeActive: boolean;
        loadedSettings: LoadedSettings;
        toolCalls?: TrackedToolCall[]; // Allow passing updated toolCalls
      }) => {
        // Update the mock's return value if new toolCalls are passed in props
        if (props.toolCalls) {
          setToolCalls(props.toolCalls);
        }
        return useGeminiStream(
          props.client,
          props.history,
          props.addItem,
          props.config,
          props.loadedSettings,
          props.onDebugMessage,
          props.handleSlashCommand,
          props.shellModeActive,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        );
      },
      {
        initialProps: {
          client,
          history: [],
          addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
          config: mockConfig,
          onDebugMessage: mockOnDebugMessage,
          handleSlashCommand: mockHandleSlashCommand as unknown as (
            cmd: PartListUnion,
          ) => Promise<SlashCommandProcessorResult | false>,
          shellModeActive: false,
          loadedSettings: mockLoadedSettings,
          toolCalls: initialToolCalls,
        },
      },
    );
    return {
      result,
      rerender,
      mockMarkToolsAsSubmitted,
      mockSendMessageStream,
      client,
    };
  };

  it('should not submit tool responses if not all tool calls are completed', () => {
    const toolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: 'call1',
          name: 'tool1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-1',
        },
        status: 'success',
        responseSubmittedToGemini: false,
        response: {
          callId: 'call1',
          responseParts: [{ text: 'tool 1 response' }],
          error: undefined,
          errorType: undefined, // FIX: Added missing property
          resultDisplay: 'Tool 1 success display',
        },
        tool: {
          name: 'tool1',
          displayName: 'tool1',
          description: 'desc1',
          build: vi.fn(),
        } as any,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
        startTime: Date.now(),
        endTime: Date.now(),
      } as TrackedCompletedToolCall,
      {
        request: {
          callId: 'call2',
          name: 'tool2',
          args: {},
          prompt_id: 'prompt-id-1',
        },
        status: 'executing',
        responseSubmittedToGemini: false,
        tool: {
          name: 'tool2',
          displayName: 'tool2',
          description: 'desc2',
          build: vi.fn(),
        } as any,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
        startTime: Date.now(),
        liveOutput: '...',
      } as TrackedExecutingToolCall,
    ];

    const { mockMarkToolsAsSubmitted, mockSendMessageStream } =
      renderTestHook(toolCalls);

    // Effect for submitting tool responses depends on toolCalls and isResponding
    // isResponding is initially false, so the effect should run.

    expect(mockMarkToolsAsSubmitted).not.toHaveBeenCalled();
    expect(mockSendMessageStream).not.toHaveBeenCalled(); // submitQuery uses this
  });

  it('should submit tool responses when all tool calls are completed and ready', async () => {
    const toolCall1ResponseParts: Part[] = [{ text: 'tool 1 final response' }];
    const toolCall2ResponseParts: Part[] = [{ text: 'tool 2 final response' }];
    const completedToolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: 'call1',
          name: 'tool1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-2',
        },
        status: 'success',
        responseSubmittedToGemini: false,
        response: {
          callId: 'call1',
          responseParts: toolCall1ResponseParts,
          errorType: undefined, // FIX: Added missing property
        },
        tool: {
          displayName: 'MockTool',
        },
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      } as TrackedCompletedToolCall,
      {
        request: {
          callId: 'call2',
          name: 'tool2',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-2',
        },
        status: 'error',
        responseSubmittedToGemini: false,
        response: {
          callId: 'call2',
          responseParts: toolCall2ResponseParts,
          errorType: ToolErrorType.UNHANDLED_EXCEPTION, // FIX: Added missing property
        },
      } as TrackedCompletedToolCall, // Treat error as a form of completion for submission
    ];

    // Capture the onComplete callback
    let capturedOnComplete:
      | ((completedTools: TrackedToolCall[]) => Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [[], mockScheduleToolCalls, mockMarkToolsAsSubmitted];
    });

    renderHook(() =>
      useGeminiStream(
        new MockedGeminiClientClass(mockConfig),
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        false,
        () => {},
        () => {},
        () => {},
        () => {},
        80,
        24,
      ),
    );

    // Trigger the onComplete callback with completed tools
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(completedToolCalls);
      }
    });

    await waitFor(() => {
      expect(mockMarkToolsAsSubmitted).toHaveBeenCalledTimes(1);
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    });

    const expectedMergedResponse = [
      ...toolCall1ResponseParts,
      ...toolCall2ResponseParts,
    ];
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      expectedMergedResponse,
      expect.any(AbortSignal),
      'prompt-id-2',
    );
  });

  it('should handle all tool calls being cancelled', async () => {
    const cancelledToolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: '1',
          name: 'testTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-3',
        },
        status: 'cancelled',
        response: {
          callId: '1',
          responseParts: [{ text: 'cancelled' }],
          errorType: undefined, // FIX: Added missing property
        },
        responseSubmittedToGemini: false,
        tool: {
          displayName: 'mock tool',
        },
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      } as TrackedCancelledToolCall,
    ];
    const client = new MockedGeminiClientClass(mockConfig);

    // Capture the onComplete callback
    let capturedOnComplete:
      | ((completedTools: TrackedToolCall[]) => Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [[], mockScheduleToolCalls, mockMarkToolsAsSubmitted];
    });

    renderHook(() =>
      useGeminiStream(
        client,
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        false,
        () => {},
        () => {},
        () => {},
        () => {},
        80,
        24,
      ),
    );

    // Trigger the onComplete callback with cancelled tools
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(cancelledToolCalls);
      }
    });

    await waitFor(() => {
      expect(mockMarkToolsAsSubmitted).toHaveBeenCalledWith(['1']);
      expect(client.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ text: 'cancelled' }],
      });
      // Ensure we do NOT call back to the API
      expect(mockSendMessageStream).not.toHaveBeenCalled();
    });
  });

  it('should group multiple cancelled tool call responses into a single history entry', async () => {
    const cancelledToolCall1: TrackedCancelledToolCall = {
      request: {
        callId: 'cancel-1',
        name: 'toolA',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-7',
      },
      tool: {
        name: 'toolA',
        displayName: 'toolA',
        description: 'descA',
        build: vi.fn(),
      } as any,
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      status: 'cancelled',
      response: {
        callId: 'cancel-1',
        responseParts: [
          { functionResponse: { name: 'toolA', id: 'cancel-1' } },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined, // FIX: Added missing property
      },
      responseSubmittedToGemini: false,
    };
    const cancelledToolCall2: TrackedCancelledToolCall = {
      request: {
        callId: 'cancel-2',
        name: 'toolB',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-8',
      },
      tool: {
        name: 'toolB',
        displayName: 'toolB',
        description: 'descB',
        build: vi.fn(),
      } as any,
      invocation: {
        getDescription: () => `Mock description`,
      } as unknown as AnyToolInvocation,
      status: 'cancelled',
      response: {
        callId: 'cancel-2',
        responseParts: [
          { functionResponse: { name: 'toolB', id: 'cancel-2' } },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined, // FIX: Added missing property
      },
      responseSubmittedToGemini: false,
    };
    const allCancelledTools = [cancelledToolCall1, cancelledToolCall2];
    const client = new MockedGeminiClientClass(mockConfig);

    let capturedOnComplete:
      | ((completedTools: TrackedToolCall[]) => Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [[], mockScheduleToolCalls, mockMarkToolsAsSubmitted];
    });

    renderHook(() =>
      useGeminiStream(
        client,
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        false,
        () => {},
        () => {},
        () => {},
        () => {},
        80,
        24,
      ),
    );

    // Trigger the onComplete callback with multiple cancelled tools
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(allCancelledTools);
      }
    });

    await waitFor(() => {
      // The tools should be marked as submitted locally
      expect(mockMarkToolsAsSubmitted).toHaveBeenCalledWith([
        'cancel-1',
        'cancel-2',
      ]);

      // Crucially, addHistory should be called only ONCE
      expect(client.addHistory).toHaveBeenCalledTimes(1);

      // And that single call should contain BOTH function responses
      expect(client.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [
          ...(cancelledToolCall1.response.responseParts as Part[]),
          ...(cancelledToolCall2.response.responseParts as Part[]),
        ],
      });

      // No message should be sent back to the API for a turn with only cancellations
      expect(mockSendMessageStream).not.toHaveBeenCalled();
    });
  });

  it('should not flicker streaming state to Idle between tool completion and submission', async () => {
    const toolCallResponseParts: PartListUnion = [
      { text: 'tool 1 final response' },
    ];

    const initialToolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: 'call1',
          name: 'tool1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-4',
        },
        status: 'executing',
        responseSubmittedToGemini: false,
        tool: {
          name: 'tool1',
          displayName: 'tool1',
          description: 'desc',
          build: vi.fn(),
        } as any,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
        startTime: Date.now(),
      } as TrackedExecutingToolCall,
    ];

    const completedToolCalls: TrackedToolCall[] = [
      {
        ...(initialToolCalls[0] as TrackedExecutingToolCall),
        status: 'success',
        response: {
          callId: 'call1',
          responseParts: toolCallResponseParts,
          error: undefined,
          errorType: undefined, // FIX: Added missing property
          resultDisplay: 'Tool 1 success display',
        },
        endTime: Date.now(),
      } as TrackedCompletedToolCall,
    ];

    // Capture the onComplete callback
    let capturedOnComplete:
      | ((completedTools: TrackedToolCall[]) => Promise<void>)
      | null = null;
    let currentToolCalls = initialToolCalls;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        currentToolCalls,
        mockScheduleToolCalls,
        mockMarkToolsAsSubmitted,
      ];
    });

    const { result, rerender } = renderHook(() =>
      useGeminiStream(
        new MockedGeminiClientClass(mockConfig),
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        () => 'vscode' as EditorType,
        () => {},
        () => Promise.resolve(),
        false,
        () => {},
        () => {},
        () => {},
        () => {},
        80,
        24,
      ),
    );

    // 1. Initial state should be Responding because a tool is executing.
    expect(result.current.streamingState).toBe(StreamingState.Responding);

    // 2. Update the tool calls to completed state and rerender
    currentToolCalls = completedToolCalls;
    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        completedToolCalls,
        mockScheduleToolCalls,
        mockMarkToolsAsSubmitted,
      ];
    });

    act(() => {
      rerender();
    });

    // 3. The state should *still* be Responding, not Idle.
    // This is because the completed tool's response has not been submitted yet.
    expect(result.current.streamingState).toBe(StreamingState.Responding);

    // 4. Trigger the onComplete callback to simulate tool completion
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(completedToolCalls);
      }
    });

    // 5. Wait for submitQuery to be called
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        toolCallResponseParts,
        expect.any(AbortSignal),
        'prompt-id-4',
      );
    });

    // 6. After submission, the state should remain Responding until the stream completes.
    expect(result.current.streamingState).toBe(StreamingState.Responding);
  });

  describe('User Cancellation', () => {
    let keypressCallback: (key: any) => void;
    const mockUseKeypress = useKeypress as Mock;

    beforeEach(() => {
      // Capture the callback passed to useKeypress
      mockUseKeypress.mockImplementation((callback, options) => {
        if (options.isActive) {
          keypressCallback = callback;
        } else {
          keypressCallback = () => {};
        }
      });
    });

    const simulateEscapeKeyPress = () => {
      act(() => {
        keypressCallback({ name: 'escape' });
      });
    };

    it('should cancel an in-progress stream when escape is pressed', async () => {
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Part 1' };
        // Keep the stream open
        await new Promise(() => {});
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderTestHook();

      // Start a query
      await act(async () => {
        result.current.submitQuery('test query');
      });

      // Wait for the first part of the response
      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Responding);
      });

      // Simulate escape key press
      simulateEscapeKeyPress();

      // Verify cancellation message is added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          {
            type: MessageType.INFO,
            text: 'Request cancelled.',
          },
          expect.any(Number),
        );
      });

      // Verify state is reset
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should call onCancelSubmit handler when escape is pressed', async () => {
      const cancelSubmitSpy = vi.fn();
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Part 1' };
        // Keep the stream open
        await new Promise(() => {});
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderHook(() =>
        useGeminiStream(
          mockConfig.getGeminiClient(),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          cancelSubmitSpy,
          () => {},
          80,
          24,
        ),
      );

      // Start a query
      await act(async () => {
        result.current.submitQuery('test query');
      });

      simulateEscapeKeyPress();

      expect(cancelSubmitSpy).toHaveBeenCalled();
    });

    it('should call setShellInputFocused(false) when escape is pressed', async () => {
      const setShellInputFocusedSpy = vi.fn();
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Part 1' };
        await new Promise(() => {}); // Keep stream open
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderHook(() =>
        useGeminiStream(
          mockConfig.getGeminiClient(),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          vi.fn(),
          setShellInputFocusedSpy, // Pass the spy here
          80,
          24,
        ),
      );

      // Start a query
      await act(async () => {
        result.current.submitQuery('test query');
      });

      simulateEscapeKeyPress();

      expect(setShellInputFocusedSpy).toHaveBeenCalledWith(false);
    });

    it('should not do anything if escape is pressed when not responding', () => {
      const { result } = renderTestHook();

      expect(result.current.streamingState).toBe(StreamingState.Idle);

      // Simulate escape key press
      simulateEscapeKeyPress();

      // No change should happen, no cancellation message
      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Request cancelled.',
        }),
        expect.any(Number),
      );
    });

    it('should prevent further processing after cancellation', async () => {
      let continueStream: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        continueStream = resolve;
      });

      const mockStream = (async function* () {
        yield { type: 'content', value: 'Initial' };
        await streamPromise; // Wait until we manually continue
        yield { type: 'content', value: ' Canceled' };
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderTestHook();

      await act(async () => {
        result.current.submitQuery('long running query');
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Responding);
      });

      // Cancel the request
      simulateEscapeKeyPress();

      // Allow the stream to continue
      act(() => {
        continueStream();
      });

      // Wait a bit to see if the second part is processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The text should not have been updated with " Canceled"
      const lastCall = mockAddItem.mock.calls.find(
        (call) => call[0].type === 'gemini',
      );
      expect(lastCall?.[0].text).toBe('Initial');

      // The final state should be idle after cancellation
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should not cancel if a tool call is in progress (not just responding)', async () => {
      const toolCalls: TrackedToolCall[] = [
        {
          request: { callId: 'call1', name: 'tool1', args: {} },
          status: 'executing',
          responseSubmittedToGemini: false,
          tool: {
            name: 'tool1',
            description: 'desc1',
            build: vi.fn().mockImplementation((_) => ({
              getDescription: () => `Mock description`,
            })),
          } as any,
          invocation: {
            getDescription: () => `Mock description`,
          },
          startTime: Date.now(),
          liveOutput: '...',
        } as TrackedExecutingToolCall,
      ];

      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      const { result } = renderTestHook(toolCalls);

      // State is `Responding` because a tool is running
      expect(result.current.streamingState).toBe(StreamingState.Responding);

      // Try to cancel
      simulateEscapeKeyPress();

      // Nothing should happen because the state is not `Responding`
      expect(abortSpy).not.toHaveBeenCalled();
    });
  });

  describe('Slash Command Handling', () => {
    it('should schedule a tool call when the command processor returns a schedule_tool action', async () => {
      const clientToolRequest: SlashCommandProcessorResult = {
        type: 'schedule_tool',
        toolName: 'save_memory',
        toolArgs: { fact: 'test fact' },
      };
      mockHandleSlashCommand.mockResolvedValue(clientToolRequest);

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/memory add "test fact"');
      });

      await waitFor(() => {
        expect(mockScheduleToolCalls).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              name: 'save_memory',
              args: { fact: 'test fact' },
              isClientInitiated: true,
            }),
          ],
          expect.any(AbortSignal),
        );
        expect(mockSendMessageStream).not.toHaveBeenCalled();
      });
    });

    it('should stop processing and not call Gemini when a command is handled without a tool call', async () => {
      const uiOnlyCommandResult: SlashCommandProcessorResult = {
        type: 'handled',
      };
      mockHandleSlashCommand.mockResolvedValue(uiOnlyCommandResult);

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/help');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).toHaveBeenCalledWith('/help');
        expect(mockScheduleToolCalls).not.toHaveBeenCalled();
        expect(mockSendMessageStream).not.toHaveBeenCalled(); // No LLM call made
      });
    });

    it('should call Gemini with prompt content when slash command returns a `submit_prompt` action', async () => {
      const customCommandResult: SlashCommandProcessorResult = {
        type: 'submit_prompt',
        content: 'This is the actual prompt from the command file.',
      };
      mockHandleSlashCommand.mockResolvedValue(customCommandResult);

      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/my-custom-command');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).toHaveBeenCalledWith(
          '/my-custom-command',
        );

        expect(localMockSendMessageStream).not.toHaveBeenCalledWith(
          '/my-custom-command',
          expect.anything(),
          expect.anything(),
        );

        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          'This is the actual prompt from the command file.',
          expect.any(AbortSignal),
          expect.any(String),
        );

        expect(mockScheduleToolCalls).not.toHaveBeenCalled();
      });
    });

    it('should correctly handle a submit_prompt action with empty content', async () => {
      const emptyPromptResult: SlashCommandProcessorResult = {
        type: 'submit_prompt',
        content: '',
      };
      mockHandleSlashCommand.mockResolvedValue(emptyPromptResult);

      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/emptycmd');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).toHaveBeenCalledWith('/emptycmd');
        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          '',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should not call handleSlashCommand for line comments', async () => {
      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('// This is a line comment');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).not.toHaveBeenCalled();
        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          '// This is a line comment',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should not call handleSlashCommand for block comments', async () => {
      const { result, mockSendMessageStream: localMockSendMessageStream } =
        renderTestHook();

      await act(async () => {
        await result.current.submitQuery('/* This is a block comment */');
      });

      await waitFor(() => {
        expect(mockHandleSlashCommand).not.toHaveBeenCalled();
        expect(localMockSendMessageStream).toHaveBeenCalledWith(
          '/* This is a block comment */',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });
  });

  describe('Memory Refresh on save_memory', () => {
    it('should call performMemoryRefresh when a save_memory tool call completes successfully', async () => {
      const mockPerformMemoryRefresh = vi.fn();
      const completedToolCall: TrackedCompletedToolCall = {
        request: {
          callId: 'save-mem-call-1',
          name: 'save_memory',
          args: { fact: 'test' },
          isClientInitiated: true,
          prompt_id: 'prompt-id-6',
        },
        status: 'success',
        responseSubmittedToGemini: false,
        response: {
          callId: 'save-mem-call-1',
          responseParts: [{ text: 'Memory saved' }],
          resultDisplay: 'Success: Memory saved',
          error: undefined,
          errorType: undefined, // FIX: Added missing property
        },
        tool: {
          name: 'save_memory',
          displayName: 'save_memory',
          description: 'Saves memory',
          build: vi.fn(),
        } as any,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      };

      // Capture the onComplete callback
      let capturedOnComplete:
        | ((completedTools: TrackedToolCall[]) => Promise<void>)
        | null = null;

      mockUseReactToolScheduler.mockImplementation((onComplete) => {
        capturedOnComplete = onComplete;
        return [[], mockScheduleToolCalls, mockMarkToolsAsSubmitted];
      });

      renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          mockPerformMemoryRefresh,
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Trigger the onComplete callback with the completed save_memory tool
      await act(async () => {
        if (capturedOnComplete) {
          await capturedOnComplete([completedToolCall]);
        }
      });

      await waitFor(() => {
        expect(mockPerformMemoryRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Error Handling', () => {
    it('should call parseAndFormatApiError with the correct authType on stream initialization failure', async () => {
      // 1. Setup
      const mockError = new Error('Rate limit exceeded');
      const mockAuthType = AuthType.LOGIN_WITH_GOOGLE;
      mockParseAndFormatApiError.mockClear();
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield { type: 'content', value: '' };
          throw mockError;
        })(),
      );

      const testConfig = {
        ...mockConfig,
        getContentGeneratorConfig: vi.fn(() => ({
          authType: mockAuthType,
        })),
        getModel: vi.fn(() => 'gemini-2.5-pro'),
      } as unknown as Config;

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(testConfig),
          [],
          mockAddItem,
          testConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // 2. Action
      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // 3. Assertion
      await waitFor(() => {
        expect(mockParseAndFormatApiError).toHaveBeenCalledWith(
          'Rate limit exceeded',
          mockAuthType,
          undefined,
          'gemini-2.5-pro',
          'gemini-2.5-flash',
        );
      });
    });
  });

  describe('handleApprovalModeChange', () => {
    it('should auto-approve all pending tool calls when switching to YOLO mode', async () => {
      const mockOnConfirm = vi.fn().mockResolvedValue(undefined);
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirm,
            onCancel: vi.fn(),
            message: 'Replace text?',
            displayedText: 'Replace old with new',
          },
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
        {
          request: {
            callId: 'call2',
            name: 'read_file',
            args: { path: '/test/file.txt' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirm,
            onCancel: vi.fn(),
            message: 'Read file?',
            displayedText: 'Read /test/file.txt',
          },
          tool: {
            name: 'read_file',
            displayName: 'read_file',
            description: 'Read file',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // Both tool calls should be auto-approved
      expect(mockOnConfirm).toHaveBeenCalledTimes(2);
      expect(mockOnConfirm).toHaveBeenNthCalledWith(
        1,
        ToolConfirmationOutcome.ProceedOnce,
      );
      expect(mockOnConfirm).toHaveBeenNthCalledWith(
        2,
        ToolConfirmationOutcome.ProceedOnce,
      );
    });

    it('should only auto-approve edit tools when switching to AUTO_EDIT mode', async () => {
      const mockOnConfirmReplace = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmWrite = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmRead = vi.fn().mockResolvedValue(undefined);

      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmReplace,
            onCancel: vi.fn(),
            message: 'Replace text?',
            displayedText: 'Replace old with new',
          },
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
        {
          request: {
            callId: 'call2',
            name: 'write_file',
            args: { path: '/test/new.txt', content: 'content' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmWrite,
            onCancel: vi.fn(),
            message: 'Write file?',
            displayedText: 'Write to /test/new.txt',
          },
          tool: {
            name: 'write_file',
            displayName: 'write_file',
            description: 'Write file',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
        {
          request: {
            callId: 'call3',
            name: 'read_file',
            args: { path: '/test/file.txt' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmRead,
            onCancel: vi.fn(),
            message: 'Read file?',
            displayedText: 'Read /test/file.txt',
          },
          tool: {
            name: 'read_file',
            displayName: 'read_file',
            description: 'Read file',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.AUTO_EDIT);
      });

      // Only replace and write_file should be auto-approved
      expect(mockOnConfirmReplace).toHaveBeenCalledTimes(1);
      expect(mockOnConfirmReplace).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );
      expect(mockOnConfirmWrite).toHaveBeenCalledTimes(1);
      expect(mockOnConfirmWrite).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );

      // read_file should not be auto-approved
      expect(mockOnConfirmRead).not.toHaveBeenCalled();
    });

    it('should not auto-approve any tools when switching to REQUIRE_CONFIRMATION mode', async () => {
      const mockOnConfirm = vi.fn().mockResolvedValue(undefined);
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirm,
            onCancel: vi.fn(),
            message: 'Replace text?',
            displayedText: 'Replace old with new',
          },
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(
          ApprovalMode.REQUIRE_CONFIRMATION,
        );
      });

      // No tools should be auto-approved
      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully when auto-approving tool calls', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const mockOnConfirmSuccess = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmError = vi
        .fn()
        .mockRejectedValue(new Error('Approval failed'));

      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmSuccess,
            onCancel: vi.fn(),
            message: 'Replace text?',
            displayedText: 'Replace old with new',
          },
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
        {
          request: {
            callId: 'call2',
            name: 'write_file',
            args: { path: '/test/file.txt', content: 'content' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmError,
            onCancel: vi.fn(),
            message: 'Write file?',
            displayedText: 'Write to /test/file.txt',
          },
          tool: {
            name: 'write_file',
            displayName: 'write_file',
            description: 'Write file',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // Both confirmation methods should be called
      expect(mockOnConfirmSuccess).toHaveBeenCalledTimes(1);
      expect(mockOnConfirmError).toHaveBeenCalledTimes(1);

      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to auto-approve tool call call2:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should skip tool calls without confirmationDetails', async () => {
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          // No confirmationDetails
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      // Should not throw an error
      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });
    });

    it('should skip tool calls without onConfirm method in confirmationDetails', async () => {
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onCancel: vi.fn(),
            message: 'Replace text?',
            displayedText: 'Replace old with new',
            // No onConfirm method
          } as any,
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      // Should not throw an error
      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });
    });

    it('should only process tool calls with awaiting_approval status', async () => {
      const mockOnConfirmAwaiting = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmExecuting = vi.fn().mockResolvedValue(undefined);

      const mixedStatusToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmAwaiting,
            onCancel: vi.fn(),
            message: 'Replace text?',
            displayedText: 'Replace old with new',
          },
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
        {
          request: {
            callId: 'call2',
            name: 'write_file',
            args: { path: '/test/file.txt', content: 'content' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'executing',
          responseSubmittedToGemini: false,
          confirmationDetails: {
            onConfirm: mockOnConfirmExecuting,
            onCancel: vi.fn(),
            message: 'Write file?',
            displayedText: 'Write to /test/file.txt',
          },
          tool: {
            name: 'write_file',
            displayName: 'write_file',
            description: 'Write file',
            build: vi.fn(),
          } as any,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
          startTime: Date.now(),
          liveOutput: 'Writing...',
        } as TrackedExecutingToolCall,
      ];

      const { result } = renderTestHook(mixedStatusToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // Only the awaiting_approval tool should be processed
      expect(mockOnConfirmAwaiting).toHaveBeenCalledTimes(1);
      expect(mockOnConfirmExecuting).not.toHaveBeenCalled();
    });
  });

  describe('handleFinishedEvent', () => {
    it('should add info message for MAX_TOKENS finish reason', async () => {
      // Setup mock to return a stream with MAX_TOKENS finish reason
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'This is a truncated response...',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'MAX_TOKENS', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit a query
      await act(async () => {
        await result.current.submitQuery('Generate long text');
      });

      // Check that the info message was added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          {
            type: 'info',
            text: '⚠️  Response truncated due to token limits.',
          },
          expect.any(Number),
        );
      });
    });

    describe('ContextWindowWillOverflow event', () => {
      beforeEach(() => {
        vi.mocked(tokenLimit).mockReturnValue(100);
      });

      it('should add message without suggestion when remaining tokens are > 75% of limit', async () => {
        // Setup mock to return a stream with ContextWindowWillOverflow event
        // Limit is 100, remaining is 80 (> 75)
        mockSendMessageStream.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.ContextWindowWillOverflow,
              value: {
                estimatedRequestTokenCount: 20,
                remainingTokenCount: 80,
              },
            };
          })(),
        );

        const { result } = renderHook(() =>
          useGeminiStream(
            new MockedGeminiClientClass(mockConfig),
            [],
            mockAddItem,
            mockConfig,
            mockLoadedSettings,
            mockOnDebugMessage,
            mockHandleSlashCommand,
            false,
            () => 'vscode' as EditorType,
            () => {},
            () => Promise.resolve(),
            false,
            () => {},
            () => {},
            () => {},
            () => {},
            80,
            24,
          ),
        );

        // Submit a query
        await act(async () => {
          await result.current.submitQuery('Test overflow');
        });

        // Check that the message was added without suggestion
        await waitFor(() => {
          expect(mockAddItem).toHaveBeenCalledWith(
            {
              type: 'info',
              text: `Sending this message (20 tokens) might exceed the remaining context window limit (80 tokens).`,
            },
            expect.any(Number),
          );
        });
      });

      it('should add message with suggestion when remaining tokens are < 75% of limit', async () => {
        // Setup mock to return a stream with ContextWindowWillOverflow event
        // Limit is 100, remaining is 70 (< 75)
        mockSendMessageStream.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.ContextWindowWillOverflow,
              value: {
                estimatedRequestTokenCount: 30,
                remainingTokenCount: 70,
              },
            };
          })(),
        );

        const { result } = renderHook(() =>
          useGeminiStream(
            new MockedGeminiClientClass(mockConfig),
            [],
            mockAddItem,
            mockConfig,
            mockLoadedSettings,
            mockOnDebugMessage,
            mockHandleSlashCommand,
            false,
            () => 'vscode' as EditorType,
            () => {},
            () => Promise.resolve(),
            false,
            () => {},
            () => {},
            () => {},
            () => {},
            80,
            24,
          ),
        );

        // Submit a query
        await act(async () => {
          await result.current.submitQuery('Test overflow');
        });

        // Check that the message was added with suggestion
        await waitFor(() => {
          expect(mockAddItem).toHaveBeenCalledWith(
            {
              type: 'info',
              text: `Sending this message (30 tokens) might exceed the remaining context window limit (70 tokens). Please try reducing the size of your message or use the \`/compress\` command to compress the chat history.`,
            },
            expect.any(Number),
          );
        });
      });
    });

    it('should call onCancelSubmit when ContextWindowWillOverflow event is received', async () => {
      const onCancelSubmitSpy = vi.fn();
      // Setup mock to return a stream with ContextWindowWillOverflow event
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.ContextWindowWillOverflow,
            value: {
              estimatedRequestTokenCount: 100,
              remainingTokenCount: 50,
            },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          onCancelSubmitSpy,
          () => {},
          80,
          24,
        ),
      );

      // Submit a query
      await act(async () => {
        await result.current.submitQuery('Test overflow');
      });

      // Check that onCancelSubmit was called
      await waitFor(() => {
        expect(onCancelSubmitSpy).toHaveBeenCalled();
      });
    });

    it('should not add message for STOP finish reason', async () => {
      // Setup mock to return a stream with STOP finish reason
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Complete response',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit a query
      await act(async () => {
        await result.current.submitQuery('Test normal completion');
      });

      // Wait a bit to ensure no message is added
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that no info message was added for STOP
      const infoMessages = mockAddItem.mock.calls.filter(
        (call) => call[0].type === 'info',
      );
      expect(infoMessages).toHaveLength(0);
    });

    it('should not add message for FINISH_REASON_UNSPECIFIED', async () => {
      // Setup mock to return a stream with FINISH_REASON_UNSPECIFIED
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Response with unspecified finish',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: {
              reason: 'FINISH_REASON_UNSPECIFIED',
              usageMetadata: undefined,
            },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit a query
      await act(async () => {
        await result.current.submitQuery('Test unspecified finish');
      });

      // Wait a bit to ensure no message is added
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that no info message was added
      const infoMessages = mockAddItem.mock.calls.filter(
        (call) => call[0].type === 'info',
      );
      expect(infoMessages).toHaveLength(0);
    });

    it('should add appropriate messages for other finish reasons', async () => {
      const testCases = [
        {
          reason: 'SAFETY',
          message: '⚠️  Response stopped due to safety reasons.',
        },
        {
          reason: 'RECITATION',
          message: '⚠️  Response stopped due to recitation policy.',
        },
        {
          reason: 'LANGUAGE',
          message: '⚠️  Response stopped due to unsupported language.',
        },
        {
          reason: 'BLOCKLIST',
          message: '⚠️  Response stopped due to forbidden terms.',
        },
        {
          reason: 'PROHIBITED_CONTENT',
          message: '⚠️  Response stopped due to prohibited content.',
        },
        {
          reason: 'SPII',
          message:
            '⚠️  Response stopped due to sensitive personally identifiable information.',
        },
        { reason: 'OTHER', message: '⚠️  Response stopped for other reasons.' },
        {
          reason: 'MALFORMED_FUNCTION_CALL',
          message: '⚠️  Response stopped due to malformed function call.',
        },
        {
          reason: 'IMAGE_SAFETY',
          message: '⚠️  Response stopped due to image safety violations.',
        },
        {
          reason: 'UNEXPECTED_TOOL_CALL',
          message: '⚠️  Response stopped due to unexpected tool call.',
        },
      ];

      for (const { reason, message } of testCases) {
        // Reset mocks for each test case
        mockAddItem.mockClear();
        mockSendMessageStream.mockReturnValue(
          (async function* () {
            yield {
              type: ServerGeminiEventType.Content,
              value: `Response for ${reason}`,
            };
            yield {
              type: ServerGeminiEventType.Finished,
              value: { reason, usageMetadata: undefined },
            };
          })(),
        );

        const { result } = renderHook(() =>
          useGeminiStream(
            new MockedGeminiClientClass(mockConfig),
            [],
            mockAddItem,
            mockConfig,
            mockLoadedSettings,
            mockOnDebugMessage,
            mockHandleSlashCommand,
            false,
            () => 'vscode' as EditorType,
            () => {},
            () => Promise.resolve(),
            false,
            () => {},
            () => {},
            () => {},
            vi.fn(),
            80,
            24,
          ),
        );

        await act(async () => {
          await result.current.submitQuery(`Test ${reason}`);
        });

        await waitFor(() => {
          expect(mockAddItem).toHaveBeenCalledWith(
            {
              type: 'info',
              text: message,
            },
            expect.any(Number),
          );
        });
      }
    });
  });

  it('should process @include commands, adding user turn after processing to prevent race conditions', async () => {
    const rawQuery = '@include file.txt Summarize this.';
    const processedQueryParts = [
      { text: 'Summarize this with content from @file.txt' },
      { text: 'File content...' },
    ];
    const userMessageTimestamp = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(userMessageTimestamp);

    handleAtCommandSpy.mockResolvedValue({
      processedQuery: processedQueryParts,
      shouldProceed: true,
    });

    const { result } = renderHook(() =>
      useGeminiStream(
        mockConfig.getGeminiClient() as GeminiClient,
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false, // shellModeActive
        vi.fn(), // getPreferredEditor
        vi.fn(), // onAuthError
        vi.fn(), // performMemoryRefresh
        false, // modelSwitched
        vi.fn(), // setModelSwitched
        vi.fn(), // onEditorClose
        vi.fn(), // onCancelSubmit
        vi.fn(), // setShellInputFocused
        80, // terminalWidth
        24, // terminalHeight
      ),
    );

    await act(async () => {
      await result.current.submitQuery(rawQuery);
    });

    expect(handleAtCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: rawQuery,
      }),
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      {
        type: MessageType.USER,
        text: rawQuery,
      },
      userMessageTimestamp,
    );

    // FIX: The expectation now matches the actual call signature.
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      processedQueryParts, // Argument 1: The parts array directly
      expect.any(AbortSignal), // Argument 2: An AbortSignal
      expect.any(String), // Argument 3: The prompt_id string
    );
  });
  describe('Thought Reset', () => {
    it('should reset thought to null when starting a new prompt', async () => {
      // First, simulate a response with a thought
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: {
              subject: 'Previous thought',
              description: 'Old description',
            },
          };
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Some response content',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit first query to set a thought
      await act(async () => {
        await result.current.submitQuery('First query');
      });

      // Wait for the first response to complete
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'gemini',
            text: 'Some response content',
          }),
          expect.any(Number),
        );
      });

      // Now simulate a new response without a thought
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'New response content',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP', usageMetadata: undefined },
          };
        })(),
      );

      // Submit second query - thought should be reset
      await act(async () => {
        await result.current.submitQuery('Second query');
      });

      // The thought should be reset to null when starting the new prompt
      // We can verify this by checking that the LoadingIndicator would not show the previous thought
      // The actual thought state is internal to the hook, but we can verify the behavior
      // by ensuring the second response doesn't show the previous thought
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'gemini',
            text: 'New response content',
          }),
          expect.any(Number),
        );
      });
    });

    it('should memoize pendingHistoryItems', () => {
      mockUseReactToolScheduler.mockReturnValue([
        [],
        mockScheduleToolCalls,
        mockCancelAllToolCalls,
        mockMarkToolsAsSubmitted,
      ]);

      const { result, rerender } = renderHook(() =>
        useGeminiStream(
          mockConfig.getGeminiClient(),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      const firstResult = result.current.pendingHistoryItems;
      rerender();
      const secondResult = result.current.pendingHistoryItems;

      expect(firstResult).toStrictEqual(secondResult);

      const newToolCalls: TrackedToolCall[] = [
        {
          request: { callId: 'call1', name: 'tool1', args: {} },
          status: 'executing',
          tool: {
            name: 'tool1',
            displayName: 'tool1',
            description: 'desc1',
            build: vi.fn(),
          },
          invocation: {
            getDescription: () => 'Mock description',
          },
        } as unknown as TrackedExecutingToolCall,
      ];

      mockUseReactToolScheduler.mockReturnValue([
        newToolCalls,
        mockScheduleToolCalls,
        mockCancelAllToolCalls,
        mockMarkToolsAsSubmitted,
      ]);

      rerender();
      const thirdResult = result.current.pendingHistoryItems;

      expect(thirdResult).not.toStrictEqual(secondResult);
    });

    it('should reset thought to null when user cancels', async () => {
      // Mock a stream that yields a thought then gets cancelled
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: { subject: 'Some thought', description: 'Description' },
          };
          yield { type: ServerGeminiEventType.UserCancelled };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit query
      await act(async () => {
        await result.current.submitQuery('Test query');
      });

      // Verify cancellation message was added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'info',
            text: 'User cancelled the request.',
          }),
          expect.any(Number),
        );
      });

      // Verify state is reset to idle
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should reset thought to null when there is an error', async () => {
      // Mock a stream that yields a thought then encounters an error
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Thought,
            value: { subject: 'Some thought', description: 'Description' },
          };
          yield {
            type: ServerGeminiEventType.Error,
            value: { error: { message: 'Test error' } },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useGeminiStream(
          new MockedGeminiClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit query
      await act(async () => {
        await result.current.submitQuery('Test query');
      });

      // Verify error message was added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
          expect.any(Number),
        );
      });

      // Verify parseAndFormatApiError was called
      expect(mockParseAndFormatApiError).toHaveBeenCalledWith(
        { message: 'Test error' },
        expect.any(String),
        undefined,
        'gemini-2.5-pro',
        'gemini-2.5-flash',
      );
    });
  });

  describe('Loop Detection Confirmation', () => {
    beforeEach(() => {
      // Add mock for getLoopDetectionService to the config
      const mockLoopDetectionService = {
        disableForSession: vi.fn(),
      };
      mockConfig.getGeminiClient = vi.fn().mockReturnValue({
        ...new MockedGeminiClientClass(mockConfig),
        getLoopDetectionService: () => mockLoopDetectionService,
      });
    });

    it('should set loopDetectionConfirmationRequest when LoopDetected event is received', async () => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Some content',
          };
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
        expect(
          typeof result.current.loopDetectionConfirmationRequest?.onComplete,
        ).toBe('function');
      });
    });

    it('should disable loop detection and show message when user selects "disable"', async () => {
      const mockLoopDetectionService = {
        disableForSession: vi.fn(),
      };
      const mockClient = {
        ...new MockedGeminiClientClass(mockConfig),
        getLoopDetectionService: () => mockLoopDetectionService,
      };
      mockConfig.getGeminiClient = vi.fn().mockReturnValue(mockClient);

      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Wait for confirmation request to be set
      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "disable"
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'disable',
        });
      });

      // Verify loop detection was disabled
      expect(mockLoopDetectionService.disableForSession).toHaveBeenCalledTimes(
        1,
      );

      // Verify confirmation request was cleared
      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify appropriate message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'Loop detection has been disabled for this session. Please try your request again.',
        },
        expect.any(Number),
      );
    });

    it('should keep loop detection enabled and show message when user selects "keep"', async () => {
      const mockLoopDetectionService = {
        disableForSession: vi.fn(),
      };
      const mockClient = {
        ...new MockedGeminiClientClass(mockConfig),
        getLoopDetectionService: () => mockLoopDetectionService,
      };
      mockConfig.getGeminiClient = vi.fn().mockReturnValue(mockClient);

      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Wait for confirmation request to be set
      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "keep"
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'keep',
        });
      });

      // Verify loop detection was NOT disabled
      expect(mockLoopDetectionService.disableForSession).not.toHaveBeenCalled();

      // Verify confirmation request was cleared
      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify appropriate message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.',
        },
        expect.any(Number),
      );
    });

    it('should handle multiple loop detection events properly', async () => {
      const { result } = renderTestHook();

      // First loop detection - set up fresh mock for first call
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      // First loop detection
      await act(async () => {
        await result.current.submitQuery('first query');
      });

      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "keep" for first request
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'keep',
        });
      });

      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify first message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.',
        },
        expect.any(Number),
      );

      // Second loop detection - set up fresh mock for second call
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      // Second loop detection
      await act(async () => {
        await result.current.submitQuery('second query');
      });

      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "disable" for second request
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'disable',
        });
      });

      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify second message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'Loop detection has been disabled for this session. Please try your request again.',
        },
        expect.any(Number),
      );
    });

    it('should process LoopDetected event after moving pending history to history', async () => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Some response content',
          };
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Verify that the content was added to history before the loop detection dialog
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'gemini',
            text: 'Some response content',
          }),
          expect.any(Number),
        );
      });

      // Then verify loop detection confirmation request was set
      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });
    });
  });
});
