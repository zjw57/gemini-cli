/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import type {
  RoutingContext,
  RoutingDecision,
} from './routingStrategy.js'; 


/**
 * A centralized service for making model routing decisions.
 */
export class ModelRouterService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Determines which model to use for a given request context.
   *
   * @param context The full context of the request.
   * @returns A promise that resolves to a RoutingDecision.
   */
  async route(
    context: RoutingContext,
  ): Promise<RoutingDecision> {
    const startTime = Date.now();


    // System-level Fallback Mode
    // This is triggered when the user is in fallback mode for this session.
    if (this.config.isInFallbackMode()) {
      const decision: RoutingDecision = {
        model: DEFAULT_GEMINI_FLASH_MODEL,
        reason: `Using fallback model (${DEFAULT_GEMINI_FLASH_MODEL}) due to system fallback mode.`,
        metadata: {
          source: 'Fallback',
          latencyMs: Date.now() - startTime,
        },
      };
      return decision;
    }

    // User Override (model explicitly set by user)
    // TODO(abhipatel) - Change this to GEMINI_AUTO once we have proper feature
    // flag.
    if (context.model !== DEFAULT_GEMINI_MODEL) {
      return {
        model: context.model,
        reason: `Using user-specified model: ${context.model}`,
        metadata: {
          source: 'Forced',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Default model is Gemini 2.5 Pro.
    const decision: RoutingDecision = {
      model: DEFAULT_GEMINI_MODEL,
      reason: `Routing disabled. Defaulting to ${DEFAULT_GEMINI_MODEL}`,
      metadata: {
        source: 'Disabled',
        latencyMs: Date.now() - startTime,
      },
    };
    return decision;
  }
}