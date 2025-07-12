/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Credentials } from 'google-auth-library';
import { TypedEmitter } from 'tiny-typed-emitter';
import { WebLoginRequest } from '../services/AuthService.js';

export interface RuntimeEvents {
  /**
   * Fired whenever the authentication credentials change.
   * The payload is the new set of credentials, or null if the user is logged out.
   */
  'auth:credentialChange': (credentials: Credentials | null) => void;
}

export interface IRuntime extends TypedEmitter<RuntimeEvents> {
  /**
  * Starts the runtime and initializes all its internal services.
  * This must be called before any other methods.
  */
  start(): Promise<void>;

  /**
   * Generates the necessary components for a client to perform a web-based OAuth2 login.
   * @param redirectUri The URI the auth provider should redirect to after user consent.
   * This is typically a `localhost` address for a CLI client.
   * @returns A promise that resolves with the authentication URL and the state parameter
   * that the client must use to validate the callback.
   */
  getWebLoginRequest(redirectUri: string): Promise<WebLoginRequest>;

  /**
   * Exchanges an authorization code received from an OAuth2 redirect for API credentials.
   * The runtime will automatically cache the resulting credentials.
   * @param authCode The authorization code from the OAuth2 provider.
   * @param redirectUri The same redirect URI that was used to generate the login request.
   * @returns A promise that resolves with the new credentials.
   */
  exchangeCodeForToken(authCode: string, redirectUri: string): Promise<Credentials>;

  /**
   * Clears any cached OAuth2 credentials from the system. This effectively logs the user out.
   */
  clearCachedCredentials(): Promise<void>;
}

export { type Credentials };