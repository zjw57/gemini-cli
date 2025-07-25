/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIdeContextStore } from './ideContext.js';

describe('ideContext', () => {
  let ideContext: ReturnType<typeof createIdeContextStore>;

  beforeEach(() => {
    // Create a fresh, isolated instance for each test
    ideContext = createIdeContextStore();
  });

  it('should return undefined initially for ide context', () => {
    expect(ideContext.getIDEContext()).toBeUndefined();
  });

  it('should set and retrieve the ide context', () => {
    const testContext = {
      activeContext: {
        file: {
          filePath: '/path/to/test/file.ts',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    };

    ideContext.setIDEContext(testContext);

    const activeContext = ideContext.getIDEContext();
    expect(activeContext).toEqual(testContext);
  });

  it('should update the ide context when called multiple times', () => {
    const firstContext = {
      activeContext: {
        file: {
          filePath: '/path/to/first.js',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    };
    ideContext.setIDEContext(firstContext);

    const secondContext = {
      activeContext: {
        file: {
          filePath: '/path/to/second.py',
          timestamp: 12345,
        },
        cursor: { line: 20, character: 30 },
      },
    };
    ideContext.setIDEContext(secondContext);

    const activeContext = ideContext.getIDEContext();
    expect(activeContext).toEqual(secondContext);
  });

  it('should handle empty string for file path', () => {
    const testContext = {
      activeContext: {
        file: {
          filePath: '',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    };
    ideContext.setIDEContext(testContext);
    expect(ideContext.getIDEContext()).toEqual(testContext);
  });

  it('should notify subscribers when ide context changes', () => {
    const subscriber1 = vi.fn();
    const subscriber2 = vi.fn();

    ideContext.subscribeToIDEContext(subscriber1);
    ideContext.subscribeToIDEContext(subscriber2);

    const testContext = {
      activeContext: {
        file: {
          filePath: '/path/to/subscribed.ts',
          timestamp: 12345,
        },
        cursor: { line: 15, character: 25 },
      },
    };
    ideContext.setIDEContext(testContext);

    expect(subscriber1).toHaveBeenCalledTimes(1);
    expect(subscriber1).toHaveBeenCalledWith(testContext);
    expect(subscriber2).toHaveBeenCalledTimes(1);
    expect(subscriber2).toHaveBeenCalledWith(testContext);

    // Test with another update
    const newContext = {
      activeContext: {
        file: {
          filePath: '/path/to/new.js',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    };
    ideContext.setIDEContext(newContext);

    expect(subscriber1).toHaveBeenCalledTimes(2);
    expect(subscriber1).toHaveBeenCalledWith(newContext);
    expect(subscriber2).toHaveBeenCalledTimes(2);
    expect(subscriber2).toHaveBeenCalledWith(newContext);
  });

  it('should stop notifying a subscriber after unsubscribe', () => {
    const subscriber1 = vi.fn();
    const subscriber2 = vi.fn();

    const unsubscribe1 = ideContext.subscribeToIDEContext(subscriber1);
    ideContext.subscribeToIDEContext(subscriber2);

    ideContext.setIDEContext({
      activeContext: {
        file: {
          filePath: '/path/to/file1.txt',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    });
    expect(subscriber1).toHaveBeenCalledTimes(1);
    expect(subscriber2).toHaveBeenCalledTimes(1);

    unsubscribe1();

    ideContext.setIDEContext({
      activeContext: {
        file: {
          filePath: '/path/to/file2.txt',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    });
    expect(subscriber1).toHaveBeenCalledTimes(1); // Should not be called again
    expect(subscriber2).toHaveBeenCalledTimes(2);
  });

  it('should allow the cursor to be optional', () => {
    const testContext = {
      activeContext: {
        file: {
          filePath: '/path/to/test/file.ts',
          timestamp: 12345,
        },
      },
    };

    ideContext.setIDEContext(testContext);

    const activeContext = ideContext.getIDEContext();
    expect(activeContext).toEqual(testContext);
  });

  it('should clear the ide context', () => {
    const testContext = {
      activeContext: {
        file: {
          filePath: '/path/to/test/file.ts',
          timestamp: 12345,
        },
        selectedText: '1234',
      },
    };

    ideContext.setIDEContext(testContext);

    expect(ideContext.getIDEContext()).toEqual(testContext);

    ideContext.clearIDEContext();

    expect(ideContext.getIDEContext()).toBeUndefined();
  });

  it('should handle workspaceState correctly', () => {
    const testContext = {
      workspaceState: {
        recentOpenFiles: [
          {
            filePath: '/path/to/test/file.ts',
            timestamp: 12345,
          },
        ],
      },
    };

    ideContext.setIDEContext(testContext);

    const activeContext = ideContext.getIDEContext();
    expect(activeContext).toEqual(testContext);
  });
});
