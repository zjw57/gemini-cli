/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import open from 'open';
import { MCPOAuthToken, MCPOAuthTokenStorage } from './oauth-token-storage.js';
import { getErrorMessage } from '../utils/errors.js';

/**
 * OAuth configuration for an MCP server.
 */
export interface MCPOAuthConfig {
  enabled?: boolean; // Whether OAuth is enabled for this server
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  redirectUri?: string;
  tokenParamName?: string; // For SSE connections, specifies the query parameter name for the token
}

/**
 * OAuth authorization response.
 */
export interface OAuthAuthorizationResponse {
  code: string;
  state: string;
}

/**
 * OAuth token response from the authorization server.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Dynamic client registration request.
 */
export interface OAuthClientRegistrationRequest {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  code_challenge_method?: string[];
  scope?: string;
}

/**
 * Dynamic client registration response.
 */
export interface OAuthClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  code_challenge_method?: string[];
  scope?: string;
}

/**
 * PKCE (Proof Key for Code Exchange) parameters.
 */
interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Provider for handling OAuth authentication for MCP servers.
 */
export class MCPOAuthProvider {
  private static readonly REDIRECT_PORT = 7777;
  private static readonly REDIRECT_PATH = '/oauth/callback';
  private static readonly HTTP_OK = 200;
  private static readonly HTTP_REDIRECT = 302;

  /**
   * Register a client dynamically with the OAuth server.
   *
   * @param registrationUrl The client registration endpoint URL
   * @param config OAuth configuration
   * @returns The registered client information
   */
  private static async registerClient(
    registrationUrl: string,
    config: MCPOAuthConfig,
  ): Promise<OAuthClientRegistrationResponse> {
    const redirectUri =
      config.redirectUri ||
      `http://localhost:${this.REDIRECT_PORT}${this.REDIRECT_PATH}`;

    const registrationRequest: OAuthClientRegistrationRequest = {
      client_name: 'Gemini CLI MCP Client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
      code_challenge_method: ['S256'],
      scope: config.scopes?.join(' ') || '',
    };

    console.log('Client registration request:', JSON.stringify(registrationRequest, null, 2));

    const response = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Client registration failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const registrationResponse = (await response.json()) as OAuthClientRegistrationResponse;
    console.log('Client registration response:', JSON.stringify(registrationResponse, null, 2));
    
    return registrationResponse;
  }

  /**
   * Discover OAuth configuration from an MCP server URL.
   *
   * @param mcpServerUrl The MCP server URL
   * @returns OAuth configuration if discovered, null otherwise
   */
  private static async discoverOAuthFromMCPServer(
    mcpServerUrl: string,
  ): Promise<MCPOAuthConfig | null> {
    try {
      // Extract the base URL from the MCP server URL
      const serverUrl = new URL(mcpServerUrl);
      const baseUrl = `${serverUrl.protocol}//${serverUrl.host}`;

      // Try to get the protected resource metadata first
      const resourceMetadataUrl = new URL(
        '/.well-known/oauth-protected-resource',
        baseUrl,
      ).toString();

      const resourceResponse = await fetch(resourceMetadataUrl);
      if (resourceResponse.ok) {
        // If protected resource metadata exists, use it
        const resourceMetadata = await resourceResponse.json();

        if (
          resourceMetadata.authorization_servers &&
          resourceMetadata.authorization_servers.length > 0
        ) {
          // Use the first authorization server
          const authServerUrl = resourceMetadata.authorization_servers[0];

          // Get the authorization server metadata
          const authServerMetadataUrl = new URL(
            '/.well-known/oauth-authorization-server',
            authServerUrl,
          ).toString();

          const authServerResponse = await fetch(authServerMetadataUrl);
          if (!authServerResponse.ok) {
            console.error(
              `Failed to fetch authorization server metadata from ${authServerMetadataUrl}`,
            );
            return null;
          }

          const authServerMetadata = await authServerResponse.json();

          return {
            authorizationUrl: authServerMetadata.authorization_endpoint,
            tokenUrl: authServerMetadata.token_endpoint,
            scopes: authServerMetadata.scopes_supported || [],
          };
        }
      }

      // If protected resource metadata doesn't exist, try direct authorization server discovery
      // This is for servers that don't follow the protected resource metadata pattern
      console.debug(
        `Protected resource metadata not found, trying direct authorization server discovery`,
      );

      const authServerMetadataUrl = new URL(
        '/.well-known/oauth-authorization-server',
        baseUrl,
      ).toString();

      const authServerResponse = await fetch(authServerMetadataUrl);
      if (!authServerResponse.ok) {
        console.error(
          `Failed to fetch authorization server metadata from ${authServerMetadataUrl}`,
        );
        return null;
      }

      const authServerMetadata = await authServerResponse.json();

      return {
        authorizationUrl: authServerMetadata.authorization_endpoint,
        tokenUrl: authServerMetadata.token_endpoint,
        scopes: authServerMetadata.scopes_supported || [],
      };
    } catch (error) {
      console.debug(
        `Failed to discover OAuth configuration from MCP server: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Convert a Buffer to base64url format (RFC 4648 Section 5)
   * This implementation is more reliable across platforms than Node.js built-in
   */
  private static bufferToBase64url(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate PKCE parameters for OAuth flow.
   *
   * @returns PKCE parameters including code verifier, challenge, and state
   */
  private static generatePKCEParams(): PKCEParams {
    // Generate code verifier (43-128 characters) according to RFC 7636
    // Using 64 bytes of random data will give us ~86 characters when base64url encoded
    let codeVerifier = this.bufferToBase64url(crypto.randomBytes(64));
    
    // Ensure the verifier is within the valid length range (43-128 characters)
    if (codeVerifier.length < 43) {
      // Very unlikely, but pad if necessary
      codeVerifier = codeVerifier.padEnd(43, 'A');
    } else if (codeVerifier.length > 128) {
      // Truncate if too long
      codeVerifier = codeVerifier.substring(0, 128);
    }
    
    // Validate that the code verifier contains only valid characters (RFC 7636)
    // Valid characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
    const validCodeVerifierRegex = /^[A-Za-z0-9\-._~]+$/;
    if (!validCodeVerifierRegex.test(codeVerifier)) {
      throw new Error('Generated code verifier contains invalid characters');
    }

    // Generate code challenge using SHA256 - the spec requires SHA256 of the UTF-8 bytes
    // Note: Node.js crypto.createHash().update() defaults to UTF-8 for strings
    const codeChallenge = this.bufferToBase64url(
      crypto.createHash('sha256').update(codeVerifier).digest()
    );
    
    // Verify the challenge can be recreated from the verifier
    const verificationChallenge = this.bufferToBase64url(
      crypto.createHash('sha256').update(codeVerifier).digest()
    );
    if (codeChallenge !== verificationChallenge) {
      console.error('PKCE challenge verification failed! Challenge generation is not deterministic.');
    }

    // Generate state for CSRF protection
    const state = this.bufferToBase64url(crypto.randomBytes(32));

    console.log('Generated PKCE params:', {
      codeVerifierLength: codeVerifier.length,
      codeChallengeLength: codeChallenge.length,
      stateLength: state.length,
      codeVerifierSample: codeVerifier.substring(0, 20) + '...',
      codeChallengeSample: codeChallenge.substring(0, 20) + '...',
      stateSample: state.substring(0, 20) + '...'
    });

    return { codeVerifier, codeChallenge, state };
  }

  /**
   * Start a local HTTP server to handle OAuth callback.
   *
   * @param expectedState The state parameter to validate
   * @returns Promise that resolves with the authorization code
   */
  private static async startCallbackServer(
    expectedState: string,
  ): Promise<OAuthAuthorizationResponse> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(
        async (req: http.IncomingMessage, res: http.ServerResponse) => {
          try {
            const url = new URL(
              req.url!,
              `http://localhost:${this.REDIRECT_PORT}`,
            );

            if (url.pathname !== this.REDIRECT_PATH) {
              res.writeHead(404);
              res.end('Not found');
              return;
            }

            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
              res.writeHead(this.HTTP_OK, { 'Content-Type': 'text/html' });
              res.end(`
              <html>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>Error: ${(error as string).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                  <p>${((url.searchParams.get('error_description') || '') as string).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
              server.close();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (!code || !state) {
              res.writeHead(400);
              res.end('Missing code or state parameter');
              return;
            }

            if (state !== expectedState) {
              res.writeHead(400);
              res.end('Invalid state parameter');
              server.close();
              reject(new Error('State mismatch - possible CSRF attack'));
              return;
            }

            // Send success response to browser
            res.writeHead(this.HTTP_OK, { 'Content-Type': 'text/html' });
            res.end(`
            <html>
              <body>
                <h1>Authentication Successful!</h1>
                <p>You can close this window and return to Gemini CLI.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);

            server.close();
            resolve({ code, state });
          } catch (error) {
            server.close();
            reject(error);
          }
        },
      );

      server.on('error', reject);
      server.listen(this.REDIRECT_PORT, () => {
        console.log(
          `OAuth callback server listening on port ${this.REDIRECT_PORT}`,
        );
      });

      // Timeout after 5 minutes
      setTimeout(
        () => {
          server.close();
          reject(new Error('OAuth callback timeout'));
        },
        5 * 60 * 1000,
      );
    });
  }

  /**
   * Build the authorization URL with PKCE parameters.
   *
   * @param config OAuth configuration
   * @param pkceParams PKCE parameters
   * @returns The authorization URL
   */
  private static buildAuthorizationUrl(
    config: MCPOAuthConfig,
    pkceParams: PKCEParams,
  ): string {
    const redirectUri =
      config.redirectUri ||
      `http://localhost:${this.REDIRECT_PORT}${this.REDIRECT_PATH}`;

    const params = new URLSearchParams({
      client_id: config.clientId!,
      response_type: 'code',
      redirect_uri: redirectUri,
      state: pkceParams.state,
      code_challenge: pkceParams.codeChallenge,
      code_challenge_method: 'S256',
    });

    if (config.scopes && config.scopes.length > 0) {
      params.append('scope', config.scopes.join(' '));
    }

    // Add resource parameter for MCP OAuth spec compliance
    const resourceUrl = new URL(config.authorizationUrl!);
    params.append('resource', `${resourceUrl.protocol}//${resourceUrl.host}`);

    console.log('Authorization URL PKCE params:', {
      codeChallenge: pkceParams.codeChallenge,
      codeChallengeMethod: 'S256',
      state: pkceParams.state.substring(0, 20) + '...'
    });

    // Debug: Verify the challenge in the URL is correctly encoded
    console.log('Code challenge in URL:', params.get('code_challenge'));
    console.log('Code challenge matches generated?', params.get('code_challenge') === pkceParams.codeChallenge);

    return `${config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens.
   *
   * @param config OAuth configuration
   * @param code Authorization code
   * @param codeVerifier PKCE code verifier
   * @param pkceParams Full PKCE parameters for debugging
   * @returns The token response
   */
  private static async exchangeCodeForToken(
    config: MCPOAuthConfig,
    code: string,
    codeVerifier: string,
    pkceParams?: PKCEParams,
  ): Promise<OAuthTokenResponse> {
    const redirectUri =
      config.redirectUri ||
      `http://localhost:${this.REDIRECT_PORT}${this.REDIRECT_PATH}`;

    // Build parameters in the order specified by RFC 6749
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('client_id', config.clientId!);
    params.append('code_verifier', codeVerifier);

    if (config.clientSecret) {
      params.append('client_secret', config.clientSecret);
    }

    // Add resource parameter for MCP OAuth spec compliance
    const resourceUrl = new URL(config.tokenUrl!);
    params.append('resource', `${resourceUrl.protocol}//${resourceUrl.host}`);

    // For debugging: recreate the challenge from the verifier to verify they match
    const recreatedChallenge = this.bufferToBase64url(
      crypto.createHash('sha256').update(codeVerifier).digest()
    );
    
    console.log('Token exchange request params:', {
      grant_type: params.get('grant_type'),
      code: params.get('code'),
      redirect_uri: params.get('redirect_uri'),
      client_id: params.get('client_id'),
      resource: params.get('resource'),
      codeVerifierLength: codeVerifier.length,
      codeVerifier: codeVerifier.substring(0, 10) + '...',
      codeVerifierSample: codeVerifier.substring(0, 20) + '...',
      recreatedChallenge: recreatedChallenge.substring(0, 20) + '...'
    });

    // Debug: Log the exact form data being sent
    console.log('Form data being sent:', params.toString());
    console.log('Raw code verifier value:', JSON.stringify(codeVerifier));
    console.log('URLSearchParams encoded code verifier:', JSON.stringify(params.get('code_verifier')));
    
    // Debug: Test if the challenge/verifier pair is valid
    console.log('Challenge verification test:');
    console.log('  Original challenge:', pkceParams?.codeChallenge || 'NOT_AVAILABLE');
    console.log('  Recreated challenge:', recreatedChallenge);
    console.log('  Challenges match:', (pkceParams?.codeChallenge || 'NOT_AVAILABLE') === recreatedChallenge);
    
    // Additional debugging: Test the exact bytes being hashed
    const verifierBytes = Buffer.from(codeVerifier, 'utf8');
    const hashBuffer = crypto.createHash('sha256').update(verifierBytes).digest();
    const challengeFromBytes = this.bufferToBase64url(hashBuffer);
    console.log('  Challenge from explicit bytes:', challengeFromBytes);
    console.log('  All challenges match:', challengeFromBytes === recreatedChallenge && challengeFromBytes === (pkceParams?.codeChallenge || 'NOT_AVAILABLE'));

    // Debug: Log the exact request being sent
    console.log('Token exchange request details:');
    console.log('  URL:', config.tokenUrl);
    console.log('  Method: POST');
    console.log('  Headers:', { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Gemini-CLI-MCP-Client/1.0', 'Accept': 'application/json' });
    console.log('  Body length:', params.toString().length);
    console.log('  Body (first 200 chars):', params.toString().substring(0, 200) + '...');
    console.log('  Platform:', process.platform);
    console.log('  Node.js version:', process.version);
    
    const response = await fetch(config.tokenUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Gemini-CLI-MCP-Client/1.0',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    console.log('Response received:');
    console.log('  Status:', response.status);
    console.log('  Status text:', response.statusText);
    console.log('  Headers:', response.headers ? Object.fromEntries(response.headers.entries()) : 'NOT_AVAILABLE');

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed with status:', response.status);
      console.error('Error response:', errorText);
      throw new Error(
        `Token exchange failed: ${response.status} - ${errorText}`,
      );
    }

    return (await response.json()) as OAuthTokenResponse;
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param config OAuth configuration
   * @param refreshToken The refresh token
   * @returns The new token response
   */
  static async refreshAccessToken(
    config: MCPOAuthConfig,
    refreshToken: string,
    tokenUrl: string,
  ): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId!,
    });

    if (config.clientSecret) {
      params.append('client_secret', config.clientSecret);
    }

    if (config.scopes && config.scopes.length > 0) {
      params.append('scope', config.scopes.join(' '));
    }

    // Add resource parameter for MCP OAuth spec compliance
    const resourceUrl = new URL(tokenUrl);
    params.append('resource', `${resourceUrl.protocol}//${resourceUrl.host}`);

    console.log('Token refresh request params:', {
      grant_type: params.get('grant_type'),
      client_id: params.get('client_id'),
      resource: params.get('resource'),
      scope: params.get('scope'),
      tokenUrl
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token refresh failed with status:', response.status);
      console.error('Error response:', errorText);
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`,
      );
    }

    return (await response.json()) as OAuthTokenResponse;
  }

  /**
   * Perform the full OAuth authorization code flow with PKCE.
   *
   * @param serverName The name of the MCP server
   * @param config OAuth configuration
   * @param mcpServerUrl Optional MCP server URL for OAuth discovery
   * @returns The obtained OAuth token
   */
  static async authenticate(
    serverName: string,
    config: MCPOAuthConfig,
    mcpServerUrl?: string,
  ): Promise<MCPOAuthToken> {
    // If no authorization URL is provided, try to discover OAuth configuration
    if (!config.authorizationUrl && mcpServerUrl) {
      console.log(
        'No authorization URL provided, attempting OAuth discovery...',
      );

      // For SSE URLs, first check if authentication is required
      if (mcpServerUrl.includes('/sse') || !mcpServerUrl.includes('/mcp')) {
        try {
          const response = await fetch(mcpServerUrl, {
            method: 'HEAD',
            headers: {
              Accept: 'text/event-stream',
            },
          });

          if (response.status === 401 || response.status === 307) {
            const wwwAuthenticate = response.headers.get('www-authenticate');
            if (wwwAuthenticate) {
              // Parse the resource metadata URI from the header
              const resourceMetadataMatch = wwwAuthenticate.match(
                /resource_metadata_uri="([^"]+)"/,
              );
              if (resourceMetadataMatch) {
                const resourceMetadataUri = resourceMetadataMatch[1];
                console.log(
                  `Found resource metadata URI from www-authenticate header: ${resourceMetadataUri}`,
                );

                // Discover OAuth configuration from the resource metadata URI
                const resourceResponse = await fetch(resourceMetadataUri);
                if (resourceResponse.ok) {
                  const resourceMetadata = await resourceResponse.json();

                  if (
                    resourceMetadata.authorization_servers &&
                    resourceMetadata.authorization_servers.length > 0
                  ) {
                    const authServerUrl =
                      resourceMetadata.authorization_servers[0];
                    const authServerMetadataUrl = new URL(
                      '/.well-known/oauth-authorization-server',
                      authServerUrl,
                    ).toString();

                    const authServerResponse = await fetch(
                      authServerMetadataUrl,
                    );
                    if (authServerResponse.ok) {
                      const authServerMetadata =
                        await authServerResponse.json();

                      config = {
                        ...config,
                        authorizationUrl:
                          authServerMetadata.authorization_endpoint,
                        tokenUrl: authServerMetadata.token_endpoint,
                        scopes:
                          authServerMetadata.scopes_supported ||
                          config.scopes ||
                          [],
                      };

                      console.log(
                        'OAuth configuration discovered successfully from www-authenticate header',
                      );
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.debug(
            `Failed to check SSE endpoint for authentication requirements: ${getErrorMessage(error)}`,
          );
        }
      }

      // If we still don't have OAuth config, try the standard discovery
      if (!config.authorizationUrl) {
        const discoveredConfig =
          await this.discoverOAuthFromMCPServer(mcpServerUrl);
        if (discoveredConfig) {
          config = { ...config, ...discoveredConfig };
          console.log('OAuth configuration discovered successfully');
        } else {
          throw new Error(
            'Failed to discover OAuth configuration from MCP server',
          );
        }
      }
    }

    // If no client ID is provided, try dynamic client registration
    if (!config.clientId) {
      // Extract server URL from authorization URL
      if (!config.authorizationUrl) {
        throw new Error(
          'Cannot perform dynamic registration without authorization URL',
        );
      }

      const authUrl = new URL(config.authorizationUrl);
      const serverUrl = `${authUrl.protocol}//${authUrl.host}`;

      console.log(
        'No client ID provided, attempting dynamic client registration...',
      );

      // Get the authorization server metadata for registration
      const authServerMetadataUrl = new URL(
        '/.well-known/oauth-authorization-server',
        serverUrl,
      ).toString();

      const authServerResponse = await fetch(authServerMetadataUrl);
      if (!authServerResponse.ok) {
        throw new Error(
          'Failed to fetch authorization server metadata for client registration',
        );
      }

      const authServerMetadata = await authServerResponse.json();

      // Log server capabilities for debugging
      console.log('Authorization server capabilities:');
      console.log('  Code challenge methods supported:', authServerMetadata.code_challenge_methods_supported);
      console.log('  Grant types supported:', authServerMetadata.grant_types_supported);
      console.log('  Response types supported:', authServerMetadata.response_types_supported);

      // Register client if registration endpoint is available
      if (authServerMetadata.registration_endpoint) {
        const clientRegistration = await this.registerClient(
          authServerMetadata.registration_endpoint,
          config,
        );

        config.clientId = clientRegistration.client_id;
        if (clientRegistration.client_secret) {
          config.clientSecret = clientRegistration.client_secret;
        }

        console.log('Dynamic client registration successful');
        console.log('Registered client ID:', config.clientId);
        console.log('Registered client secret:', config.clientSecret ? 'YES' : 'NO');
        console.log('Registered grant types:', clientRegistration.grant_types);
        console.log('Registered code challenge methods:', clientRegistration.code_challenge_method);
        
        // Check if PKCE is properly configured
        if (!clientRegistration.code_challenge_method || clientRegistration.code_challenge_method.length === 0) {
          console.warn('WARNING: Client registration did not return code_challenge_method. This may cause PKCE failures.');
          console.warn('Server capabilities indicate PKCE support, but client registration may not have enabled it.');
          console.warn('This appears to be a server-side issue with dynamic client registration.');
          console.warn('The server supports PKCE but may not be properly configuring dynamically registered clients.');
        }
      } else {
        throw new Error(
          'No client ID provided and dynamic registration not supported',
        );
      }
    }

    // Validate configuration
    if (!config.clientId || !config.authorizationUrl || !config.tokenUrl) {
      throw new Error(
        'Missing required OAuth configuration after discovery and registration',
      );
    }

    // Generate PKCE parameters
    const pkceParams = this.generatePKCEParams();

    // Build authorization URL
    const authUrl = this.buildAuthorizationUrl(config, pkceParams);

    // Display OAuth URL in main UI (not debug console)
    process.stdout.write('\nOpening browser for OAuth authentication...\n');
    process.stdout.write('If the browser does not open, please visit:\n');
    process.stdout.write(authUrl + '\n');

    // Start callback server
    const callbackPromise = this.startCallbackServer(pkceParams.state);

    // Open browser
    try {
      // Check if we're in a headless environment more comprehensively
      const isHeadless = !process.env.DISPLAY && 
                        !process.env.WSL_DISTRO_NAME && 
                        !process.env.DESKTOP_SESSION &&
                        !process.env.XDG_SESSION_TYPE &&
                        !process.env.WAYLAND_DISPLAY &&
                        process.platform !== 'darwin'; // macOS usually has GUI available
      
      if (isHeadless) {
        console.warn(
          'No display detected. Please manually open the URL shown above in your browser.',
        );
      } else {
        await open(authUrl);
      }
    } catch (error) {
      console.warn(
        'Failed to open browser automatically:',
        getErrorMessage(error),
      );
      process.stdout.write('Please manually open the URL shown above in your browser.\n');
    }

    // Wait for callback
    const { code } = await callbackPromise;

    process.stdout.write('\nAuthorization code received, exchanging for tokens...\n');

    // Exchange code for tokens
    let tokenResponse: OAuthTokenResponse;
    try {
      tokenResponse = await this.exchangeCodeForToken(
        config,
        code,
        pkceParams.codeVerifier,
        pkceParams,
      );
      console.log('Token exchange successful, processing response...');
    } catch (exchangeError) {
      console.error('Token exchange failed:', getErrorMessage(exchangeError));
      throw exchangeError;
    }

    // Convert to our token format
    const token: MCPOAuthToken = {
      accessToken: tokenResponse.access_token,
      tokenType: tokenResponse.token_type,
      refreshToken: tokenResponse.refresh_token,
      scope: tokenResponse.scope,
    };

    if (tokenResponse.expires_in) {
      token.expiresAt = Date.now() + tokenResponse.expires_in * 1000;
    }

    // Save token
    try {
      await MCPOAuthTokenStorage.saveToken(
        serverName,
        token,
        config.clientId,
        config.tokenUrl,
      );
      process.stdout.write('Authentication successful! Token saved.\n');

      // Verify token was saved
      const savedToken = await MCPOAuthTokenStorage.getToken(serverName);
      if (savedToken) {
        console.log(
          `Token verification successful: ${savedToken.token.accessToken.substring(0, 20)}...`,
        );
      } else {
        console.error('Token verification failed: token not found after save');
      }
    } catch (saveError) {
      console.error(`Failed to save token: ${getErrorMessage(saveError)}`);
      throw saveError;
    }

    return token;
  }

  /**
   * Get a valid access token for an MCP server, refreshing if necessary.
   *
   * @param serverName The name of the MCP server
   * @param config OAuth configuration
   * @returns A valid access token or null if not authenticated
   */
  static async getValidToken(
    serverName: string,
    config: MCPOAuthConfig,
  ): Promise<string | null> {
    console.debug(`Getting valid token for server: ${serverName}`);
    const credentials = await MCPOAuthTokenStorage.getToken(serverName);

    if (!credentials) {
      console.debug(`No credentials found for server: ${serverName}`);
      return null;
    }

    const { token } = credentials;
    console.debug(
      `Found token for server: ${serverName}, expired: ${MCPOAuthTokenStorage.isTokenExpired(token)}`,
    );

    // Check if token is expired
    if (!MCPOAuthTokenStorage.isTokenExpired(token)) {
      console.debug(`Returning valid token for server: ${serverName}`);
      return token.accessToken;
    }

    // Try to refresh if we have a refresh token
    if (token.refreshToken && config.clientId && credentials.tokenUrl) {
      try {
        console.log(`Refreshing expired token for MCP server: ${serverName}`);

        const newTokenResponse = await this.refreshAccessToken(
          config,
          token.refreshToken,
          credentials.tokenUrl,
        );

        // Update stored token
        const newToken: MCPOAuthToken = {
          accessToken: newTokenResponse.access_token,
          tokenType: newTokenResponse.token_type,
          refreshToken: newTokenResponse.refresh_token || token.refreshToken,
          scope: newTokenResponse.scope || token.scope,
        };

        if (newTokenResponse.expires_in) {
          newToken.expiresAt = Date.now() + newTokenResponse.expires_in * 1000;
        }

        await MCPOAuthTokenStorage.saveToken(
          serverName,
          newToken,
          config.clientId,
          credentials.tokenUrl,
        );

        return newToken.accessToken;
      } catch (error) {
        console.error(`Failed to refresh token: ${getErrorMessage(error)}`);
        // Remove invalid token
        await MCPOAuthTokenStorage.removeToken(serverName);
      }
    }

    return null;
  }
}
