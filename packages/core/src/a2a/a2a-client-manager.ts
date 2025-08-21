/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AgentCard,
  CancelTaskResponse,
  GetTaskResponse,
  MessageSendParams,
  SendMessageResponse,
} from '@a2a-js/sdk';
import { A2AClient, A2AClientOptions } from '@a2a-js/sdk/client';
import { v4 as uuidv4 } from 'uuid';

const AGENT_CARD_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/**
 * Manages A2A clients and caches loaded agent information.
 * Follows a singleton pattern to ensure a single client instance.
 */
export class A2AClientManager {
  private static instance: A2AClientManager;
  private clients = new Map<string, A2AClient>();
  private agentCards = new Map<string, AgentCard>();

  private constructor() {}

  /**
   * Gets the singleton instance of the A2AClientManager.
   */
  static getInstance(): A2AClientManager {
    if (!A2AClientManager.instance) {
      A2AClientManager.instance = new A2AClientManager();
    }
    return A2AClientManager.instance;
  }

  /**
   * Resets the singleton instance. Only for testing purposes.
   * @internal
   */
  static resetInstanceForTesting() {
    A2AClientManager.instance = new A2AClientManager();
  }

  /**
   * Loads an agent by fetching its AgentCard and caches the client.
   * @param name The name to assign to the agent.
   * @param url The base URL of the agent.
   * @param token Optional bearer token for authentication.
   * @returns The loaded AgentCard.
   */
  async loadAgent(
    name: string,
    url: string,
    accessToken?: string,
  ): Promise<AgentCard> {
    if (this.clients.has(name)) {
      throw new Error(`Agent with name '${name}' is already loaded.`);
    }

    const options: A2AClientOptions = {
      agentCardPath: AGENT_CARD_WELL_KNOWN_PATH,
    };

    if (accessToken) {
      options.fetchImpl = (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        const newInit = { ...init, headers };
        return fetch(input, newInit);
      };
    }

    const client = new A2AClient(url, options);
    const agentCard = await client.getAgentCard();

    this.clients.set(name, client);
    this.agentCards.set(name, agentCard);

    return agentCard;
  }

  /**
   * Sends a message to a loaded agent.
   * @param agentName The name of the agent to send the message to.
   * @param message The message content.
   * @returns The response from the agent.
   */
  async sendMessage(
    agentName: string,
    message: string,
  ): Promise<SendMessageResponse> {
    const client = this.clients.get(agentName);
    if (!client) {
      throw new Error(`Agent '${agentName}' not found.`);
    }

    const messageParams: MessageSendParams = {
      message: {
        kind: 'message',
        role: 'user',
        messageId: uuidv4(),
        parts: [{ kind: 'text', text: message }],
      },
    };

    return client.sendMessage(messageParams);
  }

  /**
   * Retrieves a task from an agent.
   * @param agentName The name of the agent.
   * @param taskId The ID of the task to retrieve.
   * @returns The task details.
   */
  async getTask(agentName: string, taskId: string): Promise<GetTaskResponse> {
    const client = this.clients.get(agentName);
    if (!client) {
      throw new Error(`Agent '${agentName}' not found.`);
    }
    return client.getTask({ id: taskId });
  }

  /**
   * Cancels a task on an agent.
   * @param agentName The name of the agent.
   * @param taskId The ID of the task to cancel.
   * @returns The cancellation response.
   */
  async cancelTask(
    agentName: string,
    taskId: string,
  ): Promise<CancelTaskResponse> {
    const client = this.clients.get(agentName);
    if (!client) {
      throw new Error(`Agent '${agentName}' not found.`);
    }
    return client.cancelTask({ id: taskId });
  }
}
