/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IRuntime, RuntimeEvents } from './api/runtime.js';
import { IRuntimeConfig } from './api/runtime-config.js';
import { TypedEmitter } from 'tiny-typed-emitter';
import { ConfigService, IConfigService } from './services/ConfigService.js';

/** The dependency container for all internal services. */
interface CoreServices {
  configService: IConfigService;
  // ... other services will be added here
}

/**
 * The internal implementation of the core runtime.
 */
class Runtime extends TypedEmitter<RuntimeEvents> implements IRuntime {
  private readonly services: CoreServices;

  constructor(services: CoreServices) {
    super();
    this.services = services;
  }

  /**
   * Starts the runtime by initializing all core services in the correct order.
   */
  public async start(): Promise<void> {
    await this.services.configService.initialize();
    // In later phases, this will orchestrate the startup of all other services.
    // e.g., await this.services.toolService.initialize();
  }

  // NOTE: Public API methods like getModelName() will be added in later phases
  // once we begin migrating logic out of the legacy Config object.
  // For Phase 0, just having start() is sufficient.
}

/**
 * Factory function to create and wire up a fully-functional Runtime instance.
 * This is the designated public entry point for instantiating the core runtime.
 * It encapsulates the details of service instantiation and dependency injection.
 */
export function createRuntime(config: IRuntimeConfig): IRuntime {
  const configService = new ConfigService(config);
  // As we add more services, they will be instantiated here.
  // Example: const toolService = new ToolService(configService);

  // 2. Assemble the dependency container
  const services: CoreServices = {
    configService,
    // toolService,
  };

  // 3. Create and return the Runtime instance
  return new Runtime(services);
}