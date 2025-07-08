#!/usr/bin/env node

/**
 * Debug script to check OAuth token storage
 */

import { MCPOAuthTokenStorage } from './packages/core/dist/src/mcp/oauth-token-storage.js';

async function debugTokens() {
  console.log('Debugging OAuth token storage...');
  
  try {
    // Check if we can load tokens
    const tokens = await MCPOAuthTokenStorage.loadTokens();
    console.log(`Found ${tokens.size} stored tokens:`);
    
    for (const [serverName, credentials] of tokens.entries()) {
      console.log(`  ${serverName}:`);
      console.log(`    Access Token: ${credentials.token.accessToken.substring(0, 20)}...`);
      console.log(`    Expires At: ${credentials.token.expiresAt ? new Date(credentials.token.expiresAt).toISOString() : 'No expiry'}`);
      console.log(`    Is Expired: ${MCPOAuthTokenStorage.isTokenExpired(credentials.token)}`);
      console.log(`    Client ID: ${credentials.clientId || 'None'}`);
    }
    
    // Test specific servers
    const testServers = ['cloudflare', 'paypal', 'secops2', 'zapier2'];
    
    for (const serverName of testServers) {
      const token = await MCPOAuthTokenStorage.getToken(serverName);
      if (token) {
        console.log(`\n${serverName}: Token found, expired: ${MCPOAuthTokenStorage.isTokenExpired(token.token)}`);
      } else {
        console.log(`\n${serverName}: No token found`);
      }
    }
    
  } catch (error) {
    console.error('Error debugging tokens:', error.message);
  }
}

debugTokens(); 