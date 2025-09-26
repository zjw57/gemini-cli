/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it } from 'vitest';
import { hydrateString, recursivelyHydrateStrings } from './variables.js';

describe('hydrateString', () => {
  it('should replace a single variable', () => {
    const context = {
      extensionPath: 'path/my-extension',
    };
    const result = hydrateString('Hello, ${extensionPath}!', context);
    expect(result).toBe('Hello, path/my-extension!');
  });

  it('should resolve custom env vars', () => {
    const result = hydrateString(
      'Hello, ${MY_VAR}!',
      {},
      {
        MY_VAR: 'World',
      },
    );
    expect(result).toBe('Hello, World!');
  });
});

describe('recursivelyHydrateStrings', () => {
  it('should resolve custom env vars recursively', () => {
    const obj = {
      a: 'Hello, ${MY_VAR}!',
      b: {
        c: 'Nested hello, ${MY_VAR}!',
      },
    };
    const result = recursivelyHydrateStrings(obj, {}, { MY_VAR: 'World' });
    expect(result).toEqual({
      a: 'Hello, World!',
      b: {
        c: 'Nested hello, World!',
      },
    });
  });
});
