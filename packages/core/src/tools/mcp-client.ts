/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parse } from 'shell-quote';
import { MCPServerConfig } from '../config/config.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { Type, mcpToTool } from '@google/genai';
import { sanitizeParameters, ToolRegistry } from './tool-registry.js';
import { MCPOAuthProvider } from '../mcp/oauth-provider.js';
import { getErrorMessage } from '../utils/errors.js';

export const MCP_DEFAULT_TIMEOUT_MSEC = 10 * 60 * 1000; // default to 10 minutes

/**
 * Enum representing the connection status of an MCP server
 */
export enum MCPServerStatus {
  /** Server is disconnected or experiencing errors */
  DISCONNECTED = 'disconnected',
  /** Server is in the process of connecting */
  CONNECTING = 'connecting',
  /** Server is connected and ready to use */
  CONNECTED = 'connected',
}

/**
 * Enum representing the overall MCP discovery state
 */
export enum MCPDiscoveryState {
  /** Discovery has not started yet */
  NOT_STARTED = 'not_started',
  /** Discovery is currently in progress */
  IN_PROGRESS = 'in_progress',
  /** Discovery has completed (with or without errors) */
  COMPLETED = 'completed',
}

/**
 * Map to track the status of each MCP server within the core package
 */
const mcpServerStatusesInternal: Map<string, MCPServerStatus> = new Map();

/**
 * Track the overall MCP discovery state
 */
let mcpDiscoveryState: MCPDiscoveryState = MCPDiscoveryState.NOT_STARTED;

/**
 * Event listeners for MCP server status changes
 */
type StatusChangeListener = (
  serverName: string,
  status: MCPServerStatus,
) => void;
const statusChangeListeners: StatusChangeListener[] = [];

/**
 * Add a listener for MCP server status changes
 */
export function addMCPStatusChangeListener(
  listener: StatusChangeListener,
): void {
  statusChangeListeners.push(listener);
}

/**
 * Remove a listener for MCP server status changes
 */
export function removeMCPStatusChangeListener(
  listener: StatusChangeListener,
): void {
  const index = statusChangeListeners.indexOf(listener);
  if (index !== -1) {
    statusChangeListeners.splice(index, 1);
  }
}

/**
 * Update the status of an MCP server
 */
function updateMCPServerStatus(
  serverName: string,
  status: MCPServerStatus,
): void {
  mcpServerStatusesInternal.set(serverName, status);
  // Notify all listeners
  for (const listener of statusChangeListeners) {
    listener(serverName, status);
  }
}

/**
 * Get the current status of an MCP server
 */
export function getMCPServerStatus(serverName: string): MCPServerStatus {
  return (
    mcpServerStatusesInternal.get(serverName) || MCPServerStatus.DISCONNECTED
  );
}

/**
 * Get all MCP server statuses
 */
export function getAllMCPServerStatuses(): Map<string, MCPServerStatus> {
  return new Map(mcpServerStatusesInternal);
}

/**
 * Get the current MCP discovery state
 */
export function getMCPDiscoveryState(): MCPDiscoveryState {
  return mcpDiscoveryState;
}

/**
 * Parse www-authenticate header to extract OAuth metadata URI.
 * 
 * @param wwwAuthenticate The www-authenticate header value
 * @returns The resource metadata URI if found, null otherwise
 */
function parseWWWAuthenticate(wwwAuthenticate: string): string | null {
  // Parse header like: Bearer realm="MCP Server", resource_metadata_uri="https://..."
  const resourceMetadataMatch = wwwAuthenticate.match(/resource_metadata_uri="([^"]+)"/);
  return resourceMetadataMatch ? resourceMetadataMatch[1] : null;
}

/**
 * Discover OAuth configuration from a resource metadata URI.
 * 
 * @param resourceMetadataUri The URI to fetch resource metadata from
 * @returns OAuth configuration if discovered, null otherwise
 */
async function discoverOAuthConfig(resourceMetadataUri: string): Promise<{
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
} | null> {
  try {
    // Fetch resource metadata
    const resourceResponse = await fetch(resourceMetadataUri);
    if (!resourceResponse.ok) {
      console.debug(`Failed to fetch resource metadata from ${resourceMetadataUri}`);
      return null;
    }
    
    const resourceMetadata = await resourceResponse.json();
    
    if (!resourceMetadata.authorization_servers || resourceMetadata.authorization_servers.length === 0) {
      console.debug('No authorization servers specified in resource metadata');
      return null;
    }
    
    // Use the first authorization server
    const authServerUrl = resourceMetadata.authorization_servers[0];
    
    // Get the authorization server metadata
    const authServerMetadataUrl = new URL('/.well-known/oauth-authorization-server', authServerUrl).toString();
    
    const authServerResponse = await fetch(authServerMetadataUrl);
    if (!authServerResponse.ok) {
      console.error(`Failed to fetch authorization server metadata from ${authServerMetadataUrl}`);
      return null;
    }
    
    const authServerMetadata = await authServerResponse.json();
    
    return {
      authorizationUrl: authServerMetadata.authorization_endpoint,
      tokenUrl: authServerMetadata.token_endpoint,
      scopes: authServerMetadata.scopes_supported || [],
    };
  } catch (error) {
    console.debug(`Failed to discover OAuth configuration: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Handle automatic OAuth discovery and authentication for a server.
 * 
 * @param mcpServerName The name of the MCP server
 * @param mcpServerConfig The MCP server configuration
 * @param wwwAuthenticate The www-authenticate header value
 * @returns True if OAuth was successfully configured and authenticated, false otherwise
 */
async function handleAutomaticOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string
): Promise<boolean> {
  try {
    console.log(`MCP server '${mcpServerName}' requires OAuth authentication. Discovering configuration...`);
    
    // Always try to parse the resource metadata URI from the www-authenticate header
    let oauthConfig;
    const resourceMetadataUri = parseWWWAuthenticate(wwwAuthenticate);
    if (resourceMetadataUri) {
      oauthConfig = await discoverOAuthConfig(resourceMetadataUri);
    } else if (mcpServerConfig.url) {
      // Fallback: try to discover OAuth config from the base URL for SSE
      const sseUrl = new URL(mcpServerConfig.url);
      const baseUrl = `${sseUrl.protocol}//${sseUrl.host}`;
      oauthConfig = await discoverOAuthConfig(baseUrl);
    } else if (mcpServerConfig.httpUrl) {
      // Fallback: try to discover OAuth config from the base URL for HTTP
      const httpUrl = new URL(mcpServerConfig.httpUrl);
      const baseUrl = `${httpUrl.protocol}//${httpUrl.host}`;
      oauthConfig = await discoverOAuthConfig(baseUrl);
    }
    
    if (!oauthConfig) {
      console.error(`Failed to discover OAuth configuration for server '${mcpServerName}'`);
      return false;
    }
    
    console.log(`Discovered OAuth configuration for server '${mcpServerName}':`);
    console.log(`  Authorization URL: ${oauthConfig.authorizationUrl}`);
    console.log(`  Token URL: ${oauthConfig.tokenUrl}`);
    console.log(`  Scopes: ${oauthConfig.scopes.join(', ')}`);
    
    // Create OAuth configuration for authentication
    const oauthAuthConfig = {
      enabled: true,
      authorizationUrl: oauthConfig.authorizationUrl,
      tokenUrl: oauthConfig.tokenUrl,
      scopes: oauthConfig.scopes,
    };
    
    // Perform OAuth authentication
    console.log(`Starting OAuth authentication for server '${mcpServerName}'...`);
    await MCPOAuthProvider.authenticate(mcpServerName, oauthAuthConfig);
    
    console.log(`OAuth authentication successful for server '${mcpServerName}'`);
    return true;
  } catch (error) {
    console.error(`Failed to handle automatic OAuth for server '${mcpServerName}': ${getErrorMessage(error)}`);
    return false;
  }
}

/**
 * Check if an SSE endpoint requires OAuth by making a HEAD request.
 * Returns the www-authenticate header value if authentication is required.
 */
async function checkSSEAuthRequirement(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Accept': 'text/event-stream',
      },
    });
    
    if (response.status === 401 || response.status === 307) {
      const wwwAuthenticate = response.headers.get('www-authenticate');
      if (wwwAuthenticate) {
        return wwwAuthenticate;
      }
    }
  } catch (error) {
    // If HEAD fails, try GET
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      
      if (response.status === 401 || response.status === 307) {
        const wwwAuthenticate = response.headers.get('www-authenticate');
        if (wwwAuthenticate) {
          return wwwAuthenticate;
        }
      }
    } catch {
      // Ignore errors, we'll try to connect anyway
    }
  }
  
  return null;
}

export async function discoverMcpTools(
  mcpServers: Record<string, MCPServerConfig>,
  mcpServerCommand: string | undefined,
  toolRegistry: ToolRegistry,
): Promise<void> {
  // Set discovery state to in progress
  mcpDiscoveryState = MCPDiscoveryState.IN_PROGRESS;

  try {
    if (mcpServerCommand) {
      const cmd = mcpServerCommand;
      const args = parse(cmd, process.env) as string[];
      if (args.some((arg) => typeof arg !== 'string')) {
        throw new Error('failed to parse mcpServerCommand: ' + cmd);
      }
      // use generic server name 'mcp'
      mcpServers['mcp'] = {
        command: args[0],
        args: args.slice(1),
      };
    }

    const discoveryPromises = Object.entries(mcpServers).map(
      ([mcpServerName, mcpServerConfig]) =>
        connectAndDiscover(mcpServerName, mcpServerConfig, toolRegistry),
    );
    await Promise.all(discoveryPromises);

    // Mark discovery as completed
    mcpDiscoveryState = MCPDiscoveryState.COMPLETED;
  } catch (error) {
    // Still mark as completed even with errors
    mcpDiscoveryState = MCPDiscoveryState.COMPLETED;
    throw error;
  }
}

/**
 * Connects to an MCP server and discovers available tools, registering them with the tool registry.
 * This function handles the complete lifecycle of connecting to a server, discovering tools,
 * and cleaning up resources if no tools are found.
 *
 * @param mcpServerName The name identifier for this MCP server
 * @param mcpServerConfig Configuration object containing connection details
 * @param toolRegistry The registry to register discovered tools with
 * @returns Promise that resolves when discovery is complete
 */
async function connectAndDiscover(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  toolRegistry: ToolRegistry,
): Promise<void> {
  // Initialize the server status as connecting
  updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTING);

  let transport;
  if (mcpServerConfig.httpUrl) {
    const transportOptions: StreamableHTTPClientTransportOptions = {};

    // Handle OAuth authentication if configured or if we have stored tokens
    let hasOAuthConfig = mcpServerConfig.oauth?.enabled;
    let accessToken: string | null = null;
    
    if (hasOAuthConfig && mcpServerConfig.oauth) {
      accessToken = await MCPOAuthProvider.getValidToken(
        mcpServerName,
        mcpServerConfig.oauth
      );
      
      if (!accessToken) {
        console.error(
          `MCP server '${mcpServerName}' requires OAuth authentication. ` +
          `Please authenticate using the /mcp auth command.`
        );
        updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
        return;
      }
    } else {
      // Check if we have stored OAuth tokens for this server (from previous authentication)
      accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
        authorizationUrl: '', // Will be discovered automatically
        tokenUrl: '', // Will be discovered automatically
      });
      
      if (accessToken) {
        hasOAuthConfig = true;
        console.log(`Found stored OAuth token for server '${mcpServerName}'`);
      }
    }
    
    if (hasOAuthConfig && accessToken) {
      // Add Bearer token to headers
      transportOptions.requestInit = {
        headers: {
          ...mcpServerConfig.headers,
          'Authorization': `Bearer ${accessToken}`,
        },
      };
    } else if (mcpServerConfig.headers) {
      transportOptions.requestInit = {
        headers: mcpServerConfig.headers,
      };
    }
    // Note: If no OAuth is configured, we'll attempt the connection anyway
    // and handle 401 responses with automatic OAuth discovery

    transport = new StreamableHTTPClientTransport(
      new URL(mcpServerConfig.httpUrl),
      transportOptions,
    );
  } else if (mcpServerConfig.url) {
    // Handle OAuth authentication for SSE connections
    let hasOAuthConfig = mcpServerConfig.oauth?.enabled;
    let accessToken: string | null = null;
    
    if (hasOAuthConfig && mcpServerConfig.oauth) {
      accessToken = await MCPOAuthProvider.getValidToken(
        mcpServerName,
        mcpServerConfig.oauth
      );
      
      if (!accessToken) {
        console.error(
          `MCP server '${mcpServerName}' requires OAuth authentication. ` +
          `Please authenticate using the /mcp auth command.`
        );
        updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
        return;
      }
    } else {
      // Check if we have stored OAuth tokens for this server (from previous authentication)
      accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
        authorizationUrl: '', // Will be discovered automatically
        tokenUrl: '', // Will be discovered automatically
      });
      
      if (accessToken) {
        hasOAuthConfig = true;
        console.log(`Found stored OAuth token for SSE server '${mcpServerName}'`);
      }
    }
    
    // If we don't have a token yet, check if the SSE endpoint requires authentication
    if (!hasOAuthConfig && !accessToken) {
      const wwwAuthenticate = await checkSSEAuthRequirement(mcpServerConfig.url);
      if (wwwAuthenticate) {
        console.log(`SSE endpoint requires authentication. WWW-Authenticate: ${wwwAuthenticate}`);
        
        // Try automatic OAuth discovery and authentication
        const oauthSuccess = await handleAutomaticOAuth(mcpServerName, mcpServerConfig, wwwAuthenticate);
        if (oauthSuccess) {
          // Get the token that was just obtained
          accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
            authorizationUrl: '', // Will be discovered automatically
            tokenUrl: '', // Will be discovered automatically
          });
          
          if (accessToken) {
            hasOAuthConfig = true;
            console.log(`OAuth authentication successful, got token for SSE server '${mcpServerName}'`);
          }
        } else {
          console.error(`Failed to handle automatic OAuth for SSE server '${mcpServerName}'`);
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
          return;
        }
      }
    }
    
    // For SSE connections, we need to handle OAuth differently since SSEClientTransport
    // doesn't support custom headers directly. We'll need to modify the URL or use a different approach.
    if (hasOAuthConfig && accessToken) {
      // For SSE with OAuth, we'll need to append the token as a query parameter
      // or use a different approach since SSE doesn't support Authorization headers
      const sseUrl = new URL(mcpServerConfig.url);
      
      // Some SSE servers might expect the token in a specific format or path
      // Try to append common SSE paths if the URL doesn't already have them
      const urlPath = sseUrl.pathname;
      if (urlPath === '/' || urlPath === '') {
        // Try common SSE endpoint patterns
        console.log(`SSE URL has root path, checking for common SSE endpoints...`);
        const sseEndpoints = ['/sse', '/events', '/stream', '/api/sse'];
        
        for (const endpoint of sseEndpoints) {
          try {
            const testUrl = new URL(sseUrl.toString());
            testUrl.pathname = endpoint;
            console.log(`Checking SSE endpoint: ${testUrl.toString()}`);
            
            const checkResponse = await fetch(testUrl.toString(), {
              method: 'HEAD',
              headers: {
                'Accept': 'text/event-stream',
                'Authorization': `Bearer ${accessToken}`,
              },
              signal: AbortSignal.timeout(3000),
            });
            
            if (checkResponse.ok || checkResponse.status === 200) {
              console.log(`Found working SSE endpoint at: ${testUrl.toString()}`);
              sseUrl.pathname = endpoint;
              break;
            }
          } catch (e) {
            // Continue trying other endpoints
          }
        }
      }
      
      // Try different token parameter names that SSE servers might expect
      // Some servers use 'access_token', others use 'token', 'auth', or 'authorization'
      const tokenParamNames = ['access_token', 'token', 'auth', 'authorization'];
      let connectedSuccessfully = false;
      
      for (const paramName of tokenParamNames) {
        const testUrl = new URL(sseUrl.toString());
        testUrl.searchParams.set(paramName, accessToken);
        
        console.log(`Trying SSE connection with token parameter: ${paramName}`);
        const testTransport = new SSEClientTransport(testUrl);
        
        try {
          // Create a test client to check if this token format works
          const testClient = new Client({
            name: 'gemini-cli-mcp-client-test',
            version: '0.0.1',
          });
          
          await testClient.connect(testTransport, {
            timeout: 5000, // Short timeout for testing
          });
          
          // If we get here, the connection worked
          console.log(`SSE connection successful with token parameter: ${paramName}`);
          sseUrl.searchParams.set(paramName, accessToken);
          transport = new SSEClientTransport(sseUrl);
          connectedSuccessfully = true;
          
          // Close the test connection
          await testTransport.close();
          break;
        } catch (error) {
          // This token format didn't work, try the next one
          console.debug(`Token parameter '${paramName}' didn't work: ${getErrorMessage(error)}`);
          try {
            await testTransport.close();
          } catch {}
        }
      }
      
      if (!connectedSuccessfully) {
        // Fallback to the most common parameter name
        console.log(`All token parameter formats failed, using default 'access_token'`);
        sseUrl.searchParams.set('access_token', accessToken);
        transport = new SSEClientTransport(sseUrl);
      }
    } else {
      transport = new SSEClientTransport(new URL(mcpServerConfig.url));
    }
  } else if (mcpServerConfig.command) {
    transport = new StdioClientTransport({
      command: mcpServerConfig.command,
      args: mcpServerConfig.args || [],
      env: {
        ...process.env,
        ...(mcpServerConfig.env || {}),
      } as Record<string, string>,
      cwd: mcpServerConfig.cwd,
      stderr: 'pipe',
    });
  } else {
    console.error(
      `MCP server '${mcpServerName}' has invalid configuration: missing httpUrl (for Streamable HTTP), url (for SSE), and command (for stdio). Skipping.`,
    );
    // Update status to disconnected
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
    return;
  }

  if (!transport) {
    console.error(`No transport created for MCP server '${mcpServerName}'`);
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
    return;
  }

  const mcpClient = new Client({
    name: 'gemini-cli-mcp-client',
    version: '0.0.1',
  });

  // patch Client.callTool to use request timeout as genai McpCallTool.callTool does not do it
  // TODO: remove this hack once GenAI SDK does callTool with request options
  if ('callTool' in mcpClient) {
    const origCallTool = mcpClient.callTool.bind(mcpClient);
    mcpClient.callTool = function (params, resultSchema, options) {
      return origCallTool(params, resultSchema, {
        ...options,
        timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
      });
    };
  }

  try {
    await mcpClient.connect(transport, {
      timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
    });
    // Connection successful
    updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);
    console.log(`Successfully connected to MCP server '${mcpServerName}' using ${
      transport instanceof SSEClientTransport ? 'SSE' : 
      transport instanceof StreamableHTTPClientTransport ? 'HTTP' : 
      'STDIO'
    } transport`);
  } catch (error) {
    // Check if this is a 401 error that might indicate OAuth is required
    const errorString = String(error);
    if (errorString.includes('401') && (mcpServerConfig.httpUrl || mcpServerConfig.url)) {
      // Try to extract www-authenticate header from the error
      const wwwAuthenticateMatch = errorString.match(/www-authenticate:\s*([^\n]+)/i);
      if (wwwAuthenticateMatch) {
        const wwwAuthenticate = wwwAuthenticateMatch[1].trim();
        console.log(`Received 401 with www-authenticate header: ${wwwAuthenticate}`);
        
        // Try automatic OAuth discovery and authentication
        const oauthSuccess = await handleAutomaticOAuth(mcpServerName, mcpServerConfig, wwwAuthenticate);
        if (oauthSuccess) {
          // Retry connection with OAuth token
          console.log(`Retrying connection to '${mcpServerName}' with OAuth token...`);
          
          // Get the valid token - we need to create a proper OAuth config
          // The token should already be available from the authentication process
          const accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
            authorizationUrl: '', // Will be discovered automatically
            tokenUrl: '', // Will be discovered automatically
          });
          
          if (accessToken) {
            if (mcpServerConfig.httpUrl) {
              // Create new HTTP transport with OAuth token
              const oauthTransportOptions: StreamableHTTPClientTransportOptions = {
                requestInit: {
                  headers: {
                    ...mcpServerConfig.headers,
                    'Authorization': `Bearer ${accessToken}`,
                  },
                },
              };
              
              const oauthTransport = new StreamableHTTPClientTransport(
                new URL(mcpServerConfig.httpUrl),
                oauthTransportOptions,
              );
              
              try {
                await mcpClient.connect(oauthTransport, {
                  timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
                });
                // Connection successful with OAuth
                updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);
                transport = oauthTransport; // Use the OAuth transport for the rest of the function
              } catch (retryError) {
                console.error(`Failed to connect with OAuth token: ${getErrorMessage(retryError)}`);
                updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
                return;
              }
            } else if (mcpServerConfig.url) {
              // Create new SSE transport with OAuth token
              const sseUrl = new URL(mcpServerConfig.url);
              sseUrl.searchParams.set('access_token', accessToken);
              const oauthTransport = new SSEClientTransport(sseUrl);
              
              try {
                await mcpClient.connect(oauthTransport, {
                  timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
                });
                // Connection successful with OAuth
                updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);
                transport = oauthTransport; // Use the OAuth transport for the rest of the function
              } catch (retryError) {
                console.error(`Failed to connect with OAuth token: ${getErrorMessage(retryError)}`);
                updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
                return;
              }
            }
          } else {
            console.error(`Failed to get OAuth token for server '${mcpServerName}'`);
            updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
            return;
          }
        } else {
          console.error(`Failed to handle automatic OAuth for server '${mcpServerName}'`);
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
          return;
        }
      } else {
        console.error(`401 error received but no www-authenticate header found`);
        updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
        return;
      }
    } else {
      // Handle other connection errors
      const safeConfig = {
        command: mcpServerConfig.command,
        url: mcpServerConfig.url,
        httpUrl: mcpServerConfig.httpUrl,
        cwd: mcpServerConfig.cwd,
        timeout: mcpServerConfig.timeout,
        trust: mcpServerConfig.trust,
        // Exclude args, env, and headers which may contain sensitive data
      };

      let errorString =
        `failed to start or connect to MCP server '${mcpServerName}' ` +
        `${JSON.stringify(safeConfig)}; \n${error}`;
      if (process.env.SANDBOX) {
        errorString += `\nMake sure it is available in the sandbox`;
      }
      console.error(errorString);
      // Update status to disconnected
      updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
      return;
    }
  }

  mcpClient.onerror = (error) => {
    console.error(`MCP ERROR (${mcpServerName}):`, error.toString());
    
    // Check if this is an authentication error for OAuth-enabled servers
    if (mcpServerConfig.oauth?.enabled && 
        (error.toString().includes('401') || 
         error.toString().includes('Unauthorized') ||
         error.toString().includes('authentication'))) {
      console.error(`Authentication error for MCP server '${mcpServerName}'. ` +
                   `Please re-authenticate using: /mcp auth ${mcpServerName}`);
    }
    
    // Update status to disconnected on error
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
  };

  if (transport instanceof StdioClientTransport && transport.stderr) {
    transport.stderr.on('data', (data) => {
      const stderrStr = data.toString();
      // Filter out verbose INFO logs from some MCP servers
      if (!stderrStr.includes('] INFO')) {
        console.debug(`MCP STDERR (${mcpServerName}):`, stderrStr);
      }
    });
  }

  try {
    const mcpCallableTool = mcpToTool(mcpClient);
    const tool = await mcpCallableTool.tool();

    if (!tool || !Array.isArray(tool.functionDeclarations)) {
      console.error(
        `MCP server '${mcpServerName}' did not return valid tool function declarations. Skipping.`,
      );
      console.debug(`Tool response:`, tool); // Add debug logging
      if (
        transport instanceof StdioClientTransport ||
        transport instanceof SSEClientTransport ||
        transport instanceof StreamableHTTPClientTransport
      ) {
        await transport.close();
      }
      // Update status to disconnected
      updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
      return;
    }

    console.log(`Discovered ${tool.functionDeclarations.length} tools from MCP server '${mcpServerName}'`); // Add debug logging

    for (const funcDecl of tool.functionDeclarations) {
      if (!funcDecl.name) {
        console.warn(
          `Discovered a function declaration without a name from MCP server '${mcpServerName}'. Skipping.`,
        );
        continue;
      }

      const { includeTools, excludeTools } = mcpServerConfig;
      const toolName = funcDecl.name;

      let isEnabled = false;
      if (includeTools === undefined) {
        isEnabled = true;
      } else {
        isEnabled = includeTools.some(
          (tool) => tool === toolName || tool.startsWith(`${toolName}(`),
        );
      }

      if (excludeTools?.includes(toolName)) {
        isEnabled = false;
      }

      if (!isEnabled) {
        continue;
      }

      let toolNameForModel = funcDecl.name;

      // Replace invalid characters (based on 400 error message from Gemini API) with underscores
      toolNameForModel = toolNameForModel.replace(/[^a-zA-Z0-9_.-]/g, '_');

      const existingTool = toolRegistry.getTool(toolNameForModel);
      if (existingTool) {
        toolNameForModel = mcpServerName + '__' + toolNameForModel;
      }

      // If longer than 63 characters, replace middle with '___'
      // (Gemini API says max length 64, but actual limit seems to be 63)
      if (toolNameForModel.length > 63) {
        toolNameForModel =
          toolNameForModel.slice(0, 28) + '___' + toolNameForModel.slice(-32);
      }

      sanitizeParameters(funcDecl.parameters);

      toolRegistry.registerTool(
        new DiscoveredMCPTool(
          mcpCallableTool,
          mcpServerName,
          toolNameForModel,
          funcDecl.description ?? '',
          funcDecl.parameters ?? { type: Type.OBJECT, properties: {} },
          funcDecl.name,
          mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
          mcpServerConfig.trust,
        ),
      );
    }
  } catch (error) {
    console.error(
      `Failed to list or register tools for MCP server '${mcpServerName}': ${error}`,
    );
    // Ensure transport is cleaned up on error too
    if (
      transport instanceof StdioClientTransport ||
      transport instanceof SSEClientTransport ||
      transport instanceof StreamableHTTPClientTransport
    ) {
      await transport.close();
    }
    // Update status to disconnected
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
  }

  // If no tools were registered from this MCP server, the following 'if' block
  // will close the connection. This is done to conserve resources and prevent
  // an orphaned connection to a server that isn't providing any usable
  // functionality. Connections to servers that did provide tools are kept
  // open, as those tools will require the connection to function.
  if (toolRegistry.getToolsByServer(mcpServerName).length === 0) {
    console.log(
      `No tools registered from MCP server '${mcpServerName}'. Closing connection.`,
    );
    if (
      transport instanceof StdioClientTransport ||
      transport instanceof SSEClientTransport ||
      transport instanceof StreamableHTTPClientTransport
    ) {
      await transport.close();
      // Update status to disconnected
      updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
    }
  }
}
