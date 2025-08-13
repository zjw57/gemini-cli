/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';
import {
  RoutingContext,
  RoutingDecision,
  RoutingStrategy,
} from './routingStrategy.js';
import { ClassifierStrategy } from './strategies/classifierStrategy.js';

/**
 * A centralized service for making model routing decisions.
 */
export class ModelRouterService {
  private config: Config;
  private strategy: RoutingStrategy;

  constructor(config: Config) {
    this.config = config;
    this.strategy = new ClassifierStrategy();
  }

  /**
   * Determines which model to use for a given request context.
   *
   * @param context The full context of the request.
   * @param client A reference to the GeminiClient.
   * @returns A promise that resolves to a RoutingDecision.
   */
  public async route(
    context: RoutingContext,
    client: GeminiClient,
  ): Promise<RoutingDecision> {
    // Currently, due to a model bug, using Flash as one of the first few requests causes empty token responses.
    // Due to this, we will temporarily avoid routing for the first 5 parts in the history.
    // if (context.history.length < 5) {
    //   return {
    //     model: this.config.getModel(),
    //     reason: 'Cannot route to Flash for history with less than 5 parts.',
    //   };
    // }

    // Honor the override mechanism.
    if (context.forcedModel) {
      return {
        model: context.forcedModel,
        reason: `Routing bypassed by forced model directive. Using: ${context.forcedModel}`,
      };
    }

    // If no override is present, delegate to the currently configured strategy.
    return this.strategy.route(context, client);
  }
}
