/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { NARROW_WIDTH_THRESHOLD } from './constants.js';

export function isNarrowWidth(width: number): boolean {
  return width < NARROW_WIDTH_THRESHOLD;
}
