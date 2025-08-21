/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/a2a/a2a-tool.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2ATool } from './a2a-tool.js';
import { A2AClientManager } from './a2a-client-manager.js';
import { Kind } from '../tools/tools.js';

vi.mock('./a2a-client-manager.js', () => ({
  A2AClientManager: class {
    static getInstance = vi.fn().mockReturnValue({
      sendMessage: vi.fn(),
    });
  },
}));

describe('A2ATool', () => {
  const agentName = 'TestAgent';
  const skillName = 'testSkill';
  const description = 'A test skill';

  let tool: A2ATool;
  let clientManager: A2AClientManager;

  beforeEach(() => {
    tool = new A2ATool(agentName, skillName, description);
    clientManager = A2AClientManager.getInstance();
  });

  it('should have the correct properties', () => {
    expect(tool.name).toBe(`${agentName}_${skillName}`);
    expect(tool.displayName).toBe(`${agentName}: ${skillName}`);
    expect(tool.description).toBe(description);
    expect(tool.kind).toBe(Kind.Other);
    expect(tool.schema).toEqual({
      name: `${agentName}_${skillName}`,
      description,
      parametersJsonSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to send to the agent skill.',
          },
        },
        required: ['message'],
      },
    });
  });

  describe('build', () => {
    it('should return a valid A2AToolInvocation', () => {
      const params = { message: 'Hello' };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
      expect(invocation.params).toEqual(params);
    });
  });

  describe('A2AToolInvocation', () => {
    it('should call sendMessage on execute', async () => {
      const params = { message: 'Test message' };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);
      expect(clientManager.sendMessage).toHaveBeenCalledWith(
        agentName,
        params.message,
      );
    });
  });
});
