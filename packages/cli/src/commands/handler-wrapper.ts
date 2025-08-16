/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandHandler = (args: any) => Promise<void>;

export function handlerWrapper(
  handler: CommandHandler,
  errorMessage: string,
): CommandHandler {
  return async (args) => {
    try {
      await handler(args);
    } catch (e) {
      const error = e as Error;
      console.error(`${errorMessage}:`, error.message);
    }
  };
}
