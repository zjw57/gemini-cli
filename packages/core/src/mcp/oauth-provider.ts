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
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  redirectUri?: string;
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
   * Generate PKCE parameters for OAuth flow.
   * 
   * @returns PKCE parameters including code verifier, challenge, and state
   */
  private static generatePKCEParams(): PKCEParams {
    // Generate code verifier (43-128 characters)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    
    // Generate code challenge using SHA256
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('base64url');
    
    return { codeVerifier, codeChallenge, state };
  }
  
  /**
   * Start a local HTTP server to handle OAuth callback.
   * 
   * @param expectedState The state parameter to validate
   * @returns Promise that resolves with the authorization code
   */
  private static async startCallbackServer(
    expectedState: string
  ): Promise<OAuthAuthorizationResponse> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
          const url = new URL(req.url!, `http://localhost:${this.REDIRECT_PORT}`);
          
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
                  <p>Error: ${error}</p>
                  <p>${url.searchParams.get('error_description') || ''}</p>
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
      });
      
      server.listen(this.REDIRECT_PORT, () => {
        console.log(`OAuth callback server listening on port ${this.REDIRECT_PORT}`);
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth callback timeout'));
      }, 5 * 60 * 1000);
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
    pkceParams: PKCEParams
  ): string {
    const redirectUri = config.redirectUri || 
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
    
    return `${config.authorizationUrl}?${params.toString()}`;
  }
  
  /**
   * Exchange authorization code for tokens.
   * 
   * @param config OAuth configuration
   * @param code Authorization code
   * @param codeVerifier PKCE code verifier
   * @returns The token response
   */
  private static async exchangeCodeForToken(
    config: MCPOAuthConfig,
    code: string,
    codeVerifier: string
  ): Promise<OAuthTokenResponse> {
    const redirectUri = config.redirectUri || 
      `http://localhost:${this.REDIRECT_PORT}${this.REDIRECT_PATH}`;
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: config.clientId!,
    });
    
    if (config.clientSecret) {
      params.append('client_secret', config.clientSecret);
    }
    
    // Add resource parameter for MCP OAuth spec compliance
    const resourceUrl = new URL(config.tokenUrl!);
    params.append('resource', `${resourceUrl.protocol}//${resourceUrl.host}`);
    
    const response = await fetch(config.tokenUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    return await response.json() as OAuthTokenResponse;
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
    refreshToken: string
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
    const resourceUrl = new URL(config.tokenUrl!);
    params.append('resource', `${resourceUrl.protocol}//${resourceUrl.host}`);
    
    const response = await fetch(config.tokenUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }
    
    return await response.json() as OAuthTokenResponse;
  }
  
  /**
   * Perform the full OAuth authorization code flow with PKCE.
   * 
   * @param serverName The name of the MCP server
   * @param config OAuth configuration
   * @returns The obtained OAuth token
   */
  static async authenticate(
    serverName: string,
    config: MCPOAuthConfig
  ): Promise<MCPOAuthToken> {
    // Validate configuration
    if (!config.clientId || !config.authorizationUrl || !config.tokenUrl) {
      throw new Error('Missing required OAuth configuration');
    }
    
    // Generate PKCE parameters
    const pkceParams = this.generatePKCEParams();
    
    // Build authorization URL
    const authUrl = this.buildAuthorizationUrl(config, pkceParams);
    
    console.log('\nOpening browser for OAuth authentication...');
    console.log('If the browser does not open, please visit:');
    console.log(authUrl);
    
    // Start callback server
    const callbackPromise = this.startCallbackServer(pkceParams.state);
    
    // Open browser
    try {
      await open(authUrl);
    } catch (error) {
      console.warn('Failed to open browser automatically:', getErrorMessage(error));
    }
    
    // Wait for callback
    const { code } = await callbackPromise;
    
    console.log('\nAuthorization code received, exchanging for tokens...');
    
    // Exchange code for tokens
    const tokenResponse = await this.exchangeCodeForToken(
      config,
      code,
      pkceParams.codeVerifier
    );
    
    // Convert to our token format
    const token: MCPOAuthToken = {
      accessToken: tokenResponse.access_token,
      tokenType: tokenResponse.token_type,
      refreshToken: tokenResponse.refresh_token,
      scope: tokenResponse.scope,
    };
    
    if (tokenResponse.expires_in) {
      token.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
    }
    
    // Save token
    await MCPOAuthTokenStorage.saveToken(serverName, token, config.clientId);
    
    console.log('Authentication successful! Token saved.');
    
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
    config: MCPOAuthConfig
  ): Promise<string | null> {
    const credentials = await MCPOAuthTokenStorage.getToken(serverName);
    
    if (!credentials) {
      return null;
    }
    
    const { token } = credentials;
    
    // Check if token is expired
    if (!MCPOAuthTokenStorage.isTokenExpired(token)) {
      return token.accessToken;
    }
    
    // Try to refresh if we have a refresh token
    if (token.refreshToken && config.clientId && config.tokenUrl) {
      try {
        console.log(`Refreshing expired token for MCP server: ${serverName}`);
        
        const newTokenResponse = await this.refreshAccessToken(
          config,
          token.refreshToken
        );
        
        // Update stored token
        const newToken: MCPOAuthToken = {
          accessToken: newTokenResponse.access_token,
          tokenType: newTokenResponse.token_type,
          refreshToken: newTokenResponse.refresh_token || token.refreshToken,
          scope: newTokenResponse.scope || token.scope,
        };
        
        if (newTokenResponse.expires_in) {
          newToken.expiresAt = Date.now() + (newTokenResponse.expires_in * 1000);
        }
        
        await MCPOAuthTokenStorage.saveToken(serverName, newToken, config.clientId);
        
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