/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const NARROW_WIDTH_BREAKPOINT = 70;

export function isNarrowWidth(width: number): boolean {
  return width < NARROW_WIDTH_BREAKPOINT;
}
