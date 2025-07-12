/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthService, IAuthService, WebLoginRequest } from './services/AuthService.js';
import { Credentials } from 'google-auth-library';
import { IRuntime, RuntimeEvents } from './api/runtime.js';
import { IRuntimeConfig } from './api/runtime-config.js';
import { TypedEmitter } from 'tiny-typed-emitter';
import { IPlatform } from './platform/IPlatform.js';
import { NodePlatform } from './platform/NodePlatform.js';

import { ConfigService, IConfigService } from './services/ConfigService.js';

/** The dependency container for all internal services. */
interface CoreServices {
  authService: IAuthService;
  configService: IConfigService;
  platform: IPlatform;
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
    await this.services.authService.getGoogleAuthClient();
  }

  public getWebLoginRequest(redirectUri: string): Promise<WebLoginRequest> {
    return this.services.authService.getWebLoginRequest(redirectUri);
  }

  public async exchangeCodeForToken(code: string, redirectUri: string): Promise<Credentials> {
    const credentials = await this.services.authService.exchangeCodeForToken(code, redirectUri);
    this.emit('auth:credentialChange', credentials);
    return credentials;
  }

  public async clearCachedCredentials(): Promise<void> {
    await this.services.authService.clearCachedCredentials();
    this.emit('auth:credentialChange', null);
  }
}

/**
 * Factory function to create and wire up a fully-functional Runtime instance.
 * This is the designated public entry point for instantiating the core runtime.
 * It encapsulates the details of service instantiation and dependency injection.
 */
export function createRuntime(config: IRuntimeConfig): IRuntime {
  const platform = new NodePlatform();

  const configService = new ConfigService(config);
  const authService = new AuthService(configService, platform);

  const services: CoreServices = {
    platform,
    authService,
    configService,
  };

  return new Runtime(services);
}