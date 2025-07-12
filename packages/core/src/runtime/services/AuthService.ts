/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client, Credentials } from 'google-auth-library';
import crypto from 'crypto';
import { AuthType } from '../api/auth-types.js';
import { IConfigService } from './ConfigService.js';
import { IPlatform } from '../platform/IPlatform.js';

//  OAuth Client ID used to initiate OAuth2Client class.
const OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';

// OAuth Secret value used to initiate OAuth2Client class.
// Note: It's ok to save this in git because this is an installed application
// as described here: https://developers.google.com/identity/protocols/oauth2#installed
const OAUTH_CLIENT_SECRET = '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';

// OAuth Scopes for Cloud Code authorization.
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const GEMINI_DIR = '.gemini';
// TODO: New name to avoid conflicts - Make it oauth_creds.json again in the future.
const CREDENTIAL_FILENAME = 'runtime_oauth_creds.json';

/**
 * The data required for a client to initiate a web-based OAuth2 login flow.
 */
export interface WebLoginRequest {
  /** The URL the user must be directed to. */
  url: string;
  /** A unique identifier for this specific auth attempt, for CSRF protection. */
  state: string;
}

/**
 * The public interface for the authentication service.
 * It provides headless mechanisms for different auth flows.
 */
export interface IAuthService {
  /** Gets the underlying OAuth2Client, initialized with credentials if available. */
  getGoogleAuthClient(): Promise<OAuth2Client>;
  /**
   * Generates the necessary components for a web-based OAuth2 login.
   * The state parameter is generated internally for security.
   * @param redirectUri The URI the auth provider should redirect to after user consent.
   * @returns A promise that resolves with the authentication URL and the state parameter.
   */
  getWebLoginRequest(redirectUri: string): Promise<WebLoginRequest>;
  /** Exchanges an authorization code for API credentials. */
  exchangeCodeForToken(
    authCode: string,
    redirectUri: string,
  ): Promise<Credentials>;
  /** Validates if the runtime is correctly configured for a given auth type. */
  validateAuthMethod(
    authType: AuthType,
    env: Record<string, string | undefined>,
  ): Promise<{ isValid: boolean; error?: string }>;
  /** Clears any cached credentials from the system. */
  clearCachedCredentials(): Promise<void>;
}

export class AuthService implements IAuthService {
  private readonly client: OAuth2Client;
  private readonly credentialPath: string;

  constructor(
    private readonly configService: IConfigService,
    private readonly platform: IPlatform
  ) {
    this.client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    });
    this.credentialPath = this.platform.joinPath(
      this.platform.getHomeDir(),
      GEMINI_DIR,
      CREDENTIAL_FILENAME,
    );
    this.client.on('tokens', (tokens) => this._cacheCredentials(tokens));
  }

  public async getGoogleAuthClient(): Promise<OAuth2Client> {
    const hasCachedCreds = await this._loadCachedCredentials();
    if (!hasCachedCreds && this.configService.getAuthType() === AuthType.CLOUD_SHELL) {
      // Here we would implement the Cloud Shell logic from oauth2.ts
      // For now, we defer this to a later step in Phase 1.
      throw new Error("Cloud Shell auth not yet migrated.");
    }
    return this.client;
  }

  public async getWebLoginRequest(
    redirectUri: string,
  ): Promise<WebLoginRequest> {
    const state = crypto.randomBytes(32).toString('hex');
    const authUrl = this.client.generateAuthUrl({
      redirect_uri: redirectUri,
      access_type: 'offline',
      scope: OAUTH_SCOPE,
      state,
    });
    return { url: authUrl, state };
  }

  public async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<Credentials> {
    const { tokens } = await this.client.getToken({
      code,
      redirect_uri: redirectUri,
    });
    this.client.setCredentials(tokens);
    return tokens;
  }

  // TODO: Should this be an internal helper? Should  the runtime's start() or initialize() 
  // method should be responsible for calling authService.validateAuthMethod(..., process.env)
  // and throwing an error if the configuration is invalid. This way, the cli is completely
  // absolved of this responsibility.
  public async validateAuthMethod(
    authType: AuthType,
    env: Record<string, string | undefined>,
  ): Promise<{ isValid: boolean; error?: string }> {
    // Logic migrated from cli/src/config/auth.ts
    switch (authType) {
      case AuthType.LOGIN_WITH_GOOGLE:
      case AuthType.CLOUD_SHELL:
        return { isValid: true };
      case AuthType.USE_GEMINI:
        if (!env.GEMINI_API_KEY) {
          return {
            isValid: false,
            error:
              'GEMINI_API_KEY environment variable not found.',
          };
        }
        return { isValid: true };
      case AuthType.USE_VERTEX_AI:
        const hasProject = !!env.GOOGLE_CLOUD_PROJECT && !!env.GOOGLE_CLOUD_LOCATION;
        const hasApiKey = !!env.GOOGLE_API_KEY;
        if (!hasProject && !hasApiKey) {
          return {
            isValid: false,
            error:
              'Vertex AI requires either GOOGLE_CLOUD_PROJECT/LOCATION or GOOGLE_API_KEY.',
          };
        }
        return { isValid: true };
      default:
        return { isValid: false, error: 'Invalid auth method selected.' };
    }
  }

  public async clearCachedCredentials(): Promise<void> {
    try {
      await this.platform.rm(this.credentialPath);
    } catch (e) {
      // Ignore error if file doesn't exist.
      if (e instanceof Error && 'code' in e && e.code !== 'ENOENT') {
        throw e;
      }
    }
  }

  private async _cacheCredentials(credentials: Credentials): Promise<void> {
    const credString = JSON.stringify(credentials, null, 2);
    await this.platform.writeFile(this.credentialPath, credString);
  }

  private async _loadCachedCredentials(): Promise<boolean> {
    try {
      const creds = await this.platform.readFile(this.credentialPath);
      const tokens = JSON.parse(creds);
      this.client.setCredentials(tokens);

      // Verify credentials are valid enough to get an access token.
      const accessToken = await this.client.getAccessToken();
      return !!accessToken.token;
    } catch {
      return false;
    }
  }
}