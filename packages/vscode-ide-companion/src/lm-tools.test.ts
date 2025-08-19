/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LanguageModelTools } from './lm-tools.js';
import { z } from 'zod';

describe('LanguageModelTools', () => {
  let log: (message: string) => void;
  let server: McpServer;
  let lmTools: LanguageModelTools;

  beforeEach(() => {
    log = vi.fn();
    server = new McpServer({ name: 'test', version: '1.0.0' });
    lmTools = new LanguageModelTools(log);
    vi.spyOn(server, 'registerTool');
  });

  it('should register tools from vscode.lm.tools', async () => {
    const mockTools = [
      {
        name: 'tool1',
        description: 'description1',
        inputSchema: z.object({ param1: z.string() }),
        tags: [],
      },
      {
        name: 'tool2',
        description: 'description2',
        inputSchema: z.object({ param2: z.number() }),
        tags: [],
      },
    ];
    vi.spyOn(vscode.lm, 'tools', 'get').mockResolvedValue(mockTools);

    await lmTools.registerTools(server);

    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.registerTool).toHaveBeenCalledWith(
      'tool1',
      {
        description: 'description1',
        inputSchema: mockTools[0].inputSchema,
      },
      expect.any(Function),
    );
    expect(server.registerTool).toHaveBeenCalledWith(
      'tool2',
      {
        description: 'description2',
        inputSchema: mockTools[1].inputSchema,
      },
      expect.any(Function),
    );
  });

  it('should invoke the correct tool with the correct input', async () => {
    const mockTools = [
      {
        name: 'tool1',
        description: 'description1',
        inputSchema: z.object({ param1: z.string() }),
        tags: [],
      },
    ];
    vi.spyOn(vscode.lm, 'tools', 'get').mockResolvedValue(mockTools);
    const invokeToolSpy = vi
      .spyOn(vscode.lm, 'invokeTool')
      .mockResolvedValue({} as vscode.LanguageModelToolResult);

    await lmTools.registerTools(server);

    const toolImplementation = (server.registerTool as any).mock.calls[0][2];
    const input = { param1: 'test' };
    const result = await toolImplementation(input);

    expect(invokeToolSpy).toHaveBeenCalledWith('tool1', {
      toolInvocationToken: undefined,
      input,
    });
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({}),
        },
      ],
    });
  });

  it('should log and show an error message if tool registration fails', async () => {
    const error = new Error('test error');
    vi.spyOn(vscode.lm, 'tools', 'get').mockRejectedValue(error);
    const showErrorMessageSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    await lmTools.registerTools(server);

    expect(log).toHaveBeenCalledWith(
      `Error registering LM tools: ${error.message}`,
    );
    expect(showErrorMessageSpy).toHaveBeenCalledWith(
      `Error registering LM tools: ${error.message}`,
    );
  });
});
