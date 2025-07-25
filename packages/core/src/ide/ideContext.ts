/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Zod schema for validating a file with a timestamp.
 */
export const FileSchema = z.object({
  filePath: z.string(),
  timestamp: z.number(),
});
export type File = z.infer<typeof FileSchema>;

/**
 * Zod schema for validating the complete IDE context, including the active
 * context and workspace state.
 */
export const IDEContextSchema = z.object({
  activeContext: z
    .object({
      file: FileSchema,
      selectedText: z.string().optional(),
      cursor: z
        .object({
          line: z.number(),
          character: z.number(),
        })
        .optional(),
    })
    .optional(),
  workspaceState: z
    .object({
      recentOpenFiles: z.array(FileSchema).optional(),
    })
    .optional(),
});
export type IDEContext = z.infer<typeof IDEContextSchema>;

/**
 * Zod schema for validating the 'ide/contextUpdate' notification from the IDE.
 */
export const IDEContextNotificationSchema = z.object({
  method: z.literal('ide/contextUpdate'),
  params: IDEContextSchema,
});

type IDEContextSubscriber = (context: IDEContext | undefined) => void;

/**
 * Creates a new store for managing the IDE's context.
 * This factory function encapsulates the state and logic, allowing for the creation
 * of isolated instances, which is particularly useful for testing.
 *
 * @returns An object with methods to interact with the IDE context.
 */
export function createIdeContextStore() {
  let ideContextState: IDEContext | undefined = undefined;
  const subscribers = new Set<IDEContextSubscriber>();

  /**
   * Notifies all registered subscribers about the current IDE context.
   */
  function notifySubscribers(): void {
    for (const subscriber of subscribers) {
      subscriber(ideContextState);
    }
  }

  /**
   * Sets the IDE context and notifies all registered subscribers of the change.
   * @param newIDEContext The new IDE context from the IDE.
   */
  function setIDEContext(newIDEContext: IDEContext): void {
    ideContextState = newIDEContext;
    notifySubscribers();
  }

  /**
   * Clears the IDE context and notifies all registered subscribers of the change.
   */
  function clearIDEContext(): void {
    ideContextState = undefined;
    notifySubscribers();
  }

  /**
   * Retrieves the current IDE context.
   * @returns The `IDEContext` object if available; otherwise, `undefined`.
   */
  function getIDEContext(): IDEContext | undefined {
    return ideContextState;
  }

  /**
   * Subscribes to changes in the IDE context.
   *
   * When the IDE context changes, the provided `subscriber` function will be called.
   * Note: The subscriber is not called with the current value upon subscription.
   *
   * @param subscriber The function to be called when the IDE context changes.
   * @returns A function that, when called, will unsubscribe the provided subscriber.
   */
  function subscribeToIDEContext(subscriber: IDEContextSubscriber): () => void {
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }

  return {
    setIDEContext,
    getIDEContext,
    subscribeToIDEContext,
    clearIDEContext,
  };
}

/**
 * The default, shared instance of the IDE context store for the application.
 */
export const ideContext = createIdeContextStore();
