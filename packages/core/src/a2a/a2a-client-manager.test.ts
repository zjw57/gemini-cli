/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { A2AClientManager } from './a2a-client-manager.js';
import { AgentCard } from '@a2a-js/sdk';
import { A2AClient } from '@a2a-js/sdk/client';

vi.mock('@a2a-js/sdk/client', () => {
  const A2AClient = vi.fn();
  A2AClient.prototype.getAgentCard = vi.fn();
  A2AClient.prototype.sendMessage = vi.fn();
  A2AClient.prototype.getTask = vi.fn();
  A2AClient.prototype.cancelTask = vi.fn();
  return { A2AClient };
});

describe('A2AClientManager', () => {
  let manager: A2AClientManager;
  const mockAgentCard: Partial<AgentCard> = { name: 'TestAgent' };

  beforeEach(() => {
    vi.clearAllMocks();
    A2AClientManager.resetInstanceForTesting();
    manager = A2AClientManager.getInstance();

    vi.spyOn(A2AClient.prototype, 'getAgentCard').mockResolvedValue(
      mockAgentCard as AgentCard,
    );
    vi.spyOn(A2AClient.prototype, 'sendMessage').mockResolvedValue({
      jsonrpc: '2.0',
      id: '1',
      result: {
        kind: 'message',
        messageId: 'a',
        parts: [],
        role: 'agent',
      },
    });
    vi.spyOn(A2AClient.prototype, 'getTask').mockResolvedValue({
      jsonrpc: '2.0',
      id: '1',
      result: {
        id: 'task123',
        contextId: 'a',
        kind: 'task',
        status: { state: 'completed' },
      },
    });
    vi.spyOn(A2AClient.prototype, 'cancelTask').mockResolvedValue({
      jsonrpc: '2.0',
      id: '1',
      result: {
        id: 'task123',
        contextId: 'a',
        kind: 'task',
        status: { state: 'canceled' },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should enforce the singleton pattern', () => {
    const instance1 = A2AClientManager.getInstance();
    const instance2 = A2AClientManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  describe('loadAgent', () => {
    it('should create and cache an A2AClient', async () => {
      const agentCard = await manager.loadAgent(
        'TestAgent',
        'http://test.agent',
      );
      expect(agentCard).toBe(mockAgentCard);
      expect(A2AClient).toHaveBeenCalledWith(
        'http://test.agent',
        expect.any(Object),
      );
      expect(A2AClient.prototype.getAgentCard).toHaveBeenCalled();
    });

    it('should throw an error if an agent with the same name is already loaded', async () => {
      await manager.loadAgent('TestAgent', 'http://test.agent');
      await expect(
        manager.loadAgent('TestAgent', 'http://another.agent'),
      ).rejects.toThrow("Agent with name 'TestAgent' is already loaded.");
    });
  });

  describe('sendMessage', () => {
    it('should send a message to the correct agent', async () => {
      await manager.loadAgent('TestAgent', 'http://test.agent');
      await manager.sendMessage('TestAgent', 'Hello');
      expect(A2AClient.prototype.sendMessage).toHaveBeenCalledWith(
        expect.any(Object),
      );
    });

    it('should throw an error if the agent is not found', async () => {
      await expect(
        manager.sendMessage('NonExistentAgent', 'Hello'),
      ).rejects.toThrow("Agent 'NonExistentAgent' not found.");
    });
  });

  describe('getTask', () => {
    it('should get a task from the correct agent', async () => {
      await manager.loadAgent('TestAgent', 'http://test.agent');
      await manager.getTask('TestAgent', 'task123');
      expect(A2AClient.prototype.getTask).toHaveBeenCalledWith({
        id: 'task123',
      });
    });

    it('should throw an error if the agent is not found', async () => {
      await expect(
        manager.getTask('NonExistentAgent', 'task123'),
      ).rejects.toThrow("Agent 'NonExistentAgent' not found.");
    });
  });

  describe('cancelTask', () => {
    it('should cancel a task on the correct agent', async () => {
      await manager.loadAgent('TestAgent', 'http://test.agent');
      await manager.cancelTask('TestAgent', 'task123');
      expect(A2AClient.prototype.cancelTask).toHaveBeenCalledWith({
        id: 'task123',
      });
    });

    it('should throw an error if the agent is not found', async () => {
      await expect(
        manager.cancelTask('NonExistentAgent', 'task123'),
      ).rejects.toThrow("Agent 'NonExistentAgent' not found.");
    });
  });
});
