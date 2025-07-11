/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import { TypedEmitter } from 'tiny-typed-emitter';

export interface RuntimeEvents {
  // Empty for now. Will be populated in later phases.
  // Example: 'stateChange': (newState: UiState) => void;
}

export interface IRuntime extends TypedEmitter<RuntimeEvents> {
  start(): Promise<void>;
  // We will add getModelName() etc. later, once the services exist.
}