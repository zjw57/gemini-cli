/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Zod schema for validating a file context from the IDE.
 */
export const FileSchema = z.object({
  path: z.string(),
  timestamp: z.number(),
  isActive: z.boolean().optional(),
  selectedText: z.string().optional(),
  cursor: z
    .object({
      line: z.number(),
      character: z.number(),
    })
    .optional(),
});
export type File = z.infer<typeof FileSchema>;

export const IdeContextSchema = z.object({
  workspaceState: z
    .object({
      openFiles: z.array(FileSchema).optional(),
    })
    .optional(),
});
export type IdeContext = z.infer<typeof IdeContextSchema>;

/**
 * Zod schema for validating the 'ide/contextUpdate' notification from the IDE.
 */
export const IdeContextNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/contextUpdate'),
  params: IdeContextSchema,
});

export const IdeDiffAcceptedNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/diffAccepted'),
  params: z.object({
    filePath: z.string(),
    content: z.string(),
  }),
});

export const IdeDiffClosedNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/diffClosed'),
  params: z.object({
    filePath: z.string(),
    content: z.string().optional(),
  }),
});

export const CloseDiffResponseSchema = z
  .object({
    content: z
      .array(
        z.object({
          text: z.string(),
          type: z.literal('text'),
        }),
      )
      .min(1),
  })
  .transform((val, ctx) => {
    try {
      const parsed = JSON.parse(val.content[0].text);
      const innerSchema = z.object({ content: z.string().optional() });
      const validationResult = innerSchema.safeParse(parsed);
      if (!validationResult.success) {
        validationResult.error.issues.forEach((issue) => ctx.addIssue(issue));
        return z.NEVER;
      }
      return validationResult.data;
    } catch (_) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid JSON in text content',
      });
      return z.NEVER;
    }
  });

export type DiffUpdateResult =
  | {
      status: 'accepted';
      content?: string;
    }
  | {
      status: 'rejected';
      content: undefined;
    };

type IdeContextSubscriber = (ideContext: IdeContext | undefined) => void;

/**
 * Creates a new store for managing the IDE's context.
 * This factory function encapsulates the state and logic, allowing for the creation
 * of isolated instances, which is particularly useful for testing.
 *
 * @returns An object with methods to interact with the IDE context.
 */
export function createIdeContextStore() {
  let ideContextState: IdeContext | undefined = undefined;
  const subscribers = new Set<IdeContextSubscriber>();
  const selectionOverrides = new Map<string, boolean>();

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
   * @param newIdeContext The new IDE context from the IDE.
   */
  function setIdeContext(newIdeContext: IdeContext): void {
    ideContextState = newIdeContext;

    const openFilePaths = new Set(
      newIdeContext.workspaceState?.openFiles?.map((f) => f.path) ?? [],
    );

    for (const overridenFile of selectionOverrides.keys()) {
      if (!openFilePaths.has(overridenFile)) {
        selectionOverrides.delete(overridenFile);
      }
    }

    notifySubscribers();
  }

  /**
   * Clears the IDE context and notifies all registered subscribers of the change.
   */
  function clearIdeContext(): void {
    ideContextState = undefined;
    selectionOverrides.clear();
    notifySubscribers();
  }

  /**
   * Retrieves the current IDE context.
   * @returns The `IdeContext` object if a file is active; otherwise, `undefined`.
   */
  function getIdeContext(): IdeContext | undefined {
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
  function subscribeToIdeContext(subscriber: IdeContextSubscriber): () => void {
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }

  /**
   * Adds a file to the set of selected files.
   * @param path The absolute path of the file to select.
   */
  function selectFile(path: string) {
    selectionOverrides.set(path, true);
  }

  /**
   * Removes a file from the set of selected files.
   * @param path The absolute path of the file to deselect.
   */
  function deselectFile(path: string) {
    selectionOverrides.set(path, false);
  }

  /**
   * Checks if a file is selected, either explicitly or implicitly.
   * A file is implicitly selected if it is the active file in the IDE and not
   * explicitly deselected.
   * @param path The absolute path of the file to check.
   * @returns `true` if the file is selected, `false` otherwise.
   */
  function isFileSelected(path: string): boolean {
    const override = selectionOverrides.get(path);
    if (override !== undefined) {
      return override;
    }

    const activeFile = ideContextState?.workspaceState?.openFiles?.find(
      (f) => f.isActive,
    );
    return activeFile?.path === path;
  }

  /**
   * Returns a list of all selected files. This includes implicitly selected
   * files (i.e. the active file unless deselected) and explicitly selected
   * files. The files are sorted by recency based on the `openFiles` list from
   * the IDE.
   * @returns A list of absolute paths of the selected files.
   */
  function getSelectedFiles(): File[] {
    const openFiles = ideContextState?.workspaceState?.openFiles ?? [];
    if (!openFiles.length) {
      return [];
    }

    const activeFilePath = openFiles.find((f) => f.isActive)?.path;

    return openFiles.filter((file) => {
      const override = selectionOverrides.get(file.path);
      if (override !== undefined) {
        return override;
      }
      return file.path === activeFilePath;
    });
  }

  return {
    setIdeContext,
    getIdeContext,
    subscribeToIdeContext,
    clearIdeContext,
    selectFile,
    deselectFile,
    isFileSelected,
    getSelectedFiles,
  };
}

/**
 * The default, shared instance of the IDE context store for the application.
 */
export const ideContext = createIdeContextStore();
