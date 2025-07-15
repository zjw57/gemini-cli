/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  SSEClientTransport,
  SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parse } from 'shell-quote';
import { MCPServerConfig } from '../config/config.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { FunctionDeclaration, Type, mcpToTool } from '@google/genai';
import { sanitizeParameters, ToolRegistry } from './tool-registry.js';
import { MCPOAuthProvider } from '../mcp/oauth-provider.js';
import {
  discoverOAuthConfig,
  parseWWWAuthenticateHeader,
} from '../mcp/oauth-discovery.js';
import { getErrorMessage } from '../utils/errors.js';
import { MCPOAuthTokenStorage } from '../mcp/oauth-token-storage.js';
import {
  ActiveFileNotificationSchema,
  IDE_SERVER_NAME,
  ideContext,
} from '../services/ideContext.js';

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
 * Map to track which MCP servers have been discovered to require OAuth
 */
export const mcpServerRequiresOAuth: Map<string, boolean> = new Map();

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
function _parseWWWAuthenticate(wwwAuthenticate: string): string | null {
  // Parse header like: Bearer realm="MCP Server", resource_metadata_uri="https://..."
  const resourceMetadataMatch = wwwAuthenticate.match(
    /resource_metadata_uri="([^"]+)"/,
  );
  return resourceMetadataMatch ? resourceMetadataMatch[1] : null;
}

/**
 * Extract WWW-Authenticate header from error message string.
 * This is a more robust approach than regex matching.
 *
 * @param errorString The error message string
 * @returns The www-authenticate header value if found, null otherwise
 */
function extractWWWAuthenticateHeader(errorString: string): string | null {
  // Try multiple patterns to extract the header
  const patterns = [
    /www-authenticate:\s*([^\n\r]+)/i,
    /WWW-Authenticate:\s*([^\n\r]+)/i,
    /"www-authenticate":\s*"([^"]+)"/i,
    /'www-authenticate':\s*'([^']+)'/i,
  ];

  for (const pattern of patterns) {
    const match = errorString.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
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
  wwwAuthenticate: string,
): Promise<boolean> {
  try {
    console.log(
      `MCP server '${mcpServerName}' requires OAuth authentication. Discovering configuration...`,
    );

    // Always try to parse the resource metadata URI from the www-authenticate header
    let oauthConfig;
    const resourceMetadataUri = parseWWWAuthenticateHeader(wwwAuthenticate);
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
      console.error(
        `Failed to discover OAuth configuration for server '${mcpServerName}'`,
      );
      return false;
    }

    console.log(
      `Discovered OAuth configuration for server '${mcpServerName}':`,
    );
    console.log(`  Authorization URL: ${oauthConfig.authorizationUrl}`);
    console.log(`  Token URL: ${oauthConfig.tokenUrl}`);
    console.log(`  Scopes: ${(oauthConfig.scopes || []).join(', ')}`);

    // Create OAuth configuration for authentication
    const oauthAuthConfig = {
      enabled: true,
      authorizationUrl: oauthConfig.authorizationUrl,
      tokenUrl: oauthConfig.tokenUrl,
      scopes: oauthConfig.scopes || [],
    };

    // Perform OAuth authentication
    console.log(
      `Starting OAuth authentication for server '${mcpServerName}'...`,
    );
    await MCPOAuthProvider.authenticate(mcpServerName, oauthAuthConfig);

    console.log(
      `OAuth authentication successful for server '${mcpServerName}'`,
    );
    return true;
  } catch (error) {
    console.error(
      `Failed to handle automatic OAuth for server '${mcpServerName}': ${getErrorMessage(error)}`,
    );
    return false;
  }
}

/**
 * Create a transport with OAuth token for the given server configuration.
 *
 * @param mcpServerName The name of the MCP server
 * @param mcpServerConfig The MCP server configuration
 * @param accessToken The OAuth access token
 * @returns The transport with OAuth token, or null if creation fails
 */
async function createTransportWithOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  accessToken: string,
): Promise<StreamableHTTPClientTransport | SSEClientTransport | null> {
  try {
    if (mcpServerConfig.httpUrl) {
      // Create HTTP transport with OAuth token
      const oauthTransportOptions: StreamableHTTPClientTransportOptions = {
        requestInit: {
          headers: {
            ...mcpServerConfig.headers,
            Authorization: `Bearer ${accessToken}`,
          },
        },
      };

      return new StreamableHTTPClientTransport(
        new URL(mcpServerConfig.httpUrl),
        oauthTransportOptions,
      );
    } else if (mcpServerConfig.url) {
      // Create SSE transport with OAuth token in Authorization header
      return new SSEClientTransport(new URL(mcpServerConfig.url), {
        requestInit: {
          headers: {
            ...mcpServerConfig.headers,
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });
    }

    return null;
  } catch (error) {
    console.error(
      `Failed to create OAuth transport for server '${mcpServerName}': ${getErrorMessage(error)}`,
    );
    return null;
  }
}

/**
 * Check if an SSE endpoint requires OAuth by making a HEAD request.
 * Returns the www-authenticate header value if authentication is required.
 */
async function _checkSSEAuthRequirement(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        Accept: 'text/event-stream',
      },
    });

    if (response.status === 401 || response.status === 307) {
      const wwwAuthenticate = response.headers.get('www-authenticate');
      if (wwwAuthenticate) {
        return wwwAuthenticate;
      }
    }
  } catch (_error) {
    // If HEAD fails, try GET
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
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

/**
 * Discovers tools from all configured MCP servers and registers them with the tool registry.
 * It orchestrates the connection and discovery process for each server defined in the
 * configuration, as well as any server specified via a command-line argument.
 *
 * @param mcpServers A record of named MCP server configurations.
 * @param mcpServerCommand An optional command string for a dynamically specified MCP server.
 * @param toolRegistry The central registry where discovered tools will be registered.
 * @param debugMode Whether to enable debug mode for logging.
 * @returns A promise that resolves when the discovery process has been attempted for all servers.
 */
export async function discoverMcpTools(
  mcpServers: Record<string, MCPServerConfig>,
  mcpServerCommand: string | undefined,
  toolRegistry: ToolRegistry,
  debugMode: boolean,
): Promise<void> {
  mcpDiscoveryState = MCPDiscoveryState.IN_PROGRESS;
  try {
    mcpServers = populateMcpServerCommand(mcpServers, mcpServerCommand);

    const discoveryPromises = Object.entries(mcpServers).map(
      ([mcpServerName, mcpServerConfig]) =>
        connectAndDiscover(
          mcpServerName,
          mcpServerConfig,
          toolRegistry,
          debugMode,
        ),
    );
    await Promise.all(discoveryPromises);
  } finally {
    mcpDiscoveryState = MCPDiscoveryState.COMPLETED;
  }
}

/** Visible for Testing */
export function populateMcpServerCommand(
  mcpServers: Record<string, MCPServerConfig>,
  mcpServerCommand: string | undefined,
): Record<string, MCPServerConfig> {
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
  return mcpServers;
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
export async function connectAndDiscover(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  toolRegistry: ToolRegistry,
  debugMode: boolean,
): Promise<void> {
  updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTING);

  try {
    const mcpClient = await connectToMcpServer(
      mcpServerName,
      mcpServerConfig,
      toolRegistry,
      debugMode,
    );
    try {
      updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);

      mcpClient.onerror = (error) => {
        console.error(`MCP ERROR (${mcpServerName}):`, error.toString());
        
        // Check if this is an authentication error for OAuth-enabled servers
        if (
          mcpServerConfig.oauth?.enabled &&
          (error.toString().includes('401') ||
            error.toString().includes('Unauthorized') ||
            error.toString().includes('authentication'))
        ) {
          console.error(
            `Authentication error for MCP server '${mcpServerName}'. ` +
              `Please re-authenticate using: /mcp auth ${mcpServerName}`,
          );
        }
        
        updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
      };

      if (mcpServerName === IDE_SERVER_NAME) {
        mcpClient.setNotificationHandler(
          ActiveFileNotificationSchema,
          (notification) => {
            ideContext.setActiveFileContext(notification.params);
          },
        );
      }

      const tools = await discoverTools(
        mcpServerName,
        mcpServerConfig,
        mcpClient,
      );
      for (const tool of tools) {
        toolRegistry.registerTool(tool);
      }
    } catch (error) {
      mcpClient.close();
      throw error;
    }
  } catch (error) {
    console.error(`Error connecting to MCP server '${mcpServerName}':`, error);
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
  }
}

/**
 * Discovers and sanitizes tools from a connected MCP client.
 * It retrieves function declarations from the client, filters out disabled tools,
 * generates valid names for them, and wraps them in `DiscoveredMCPTool` instances.
 *
 * @param mcpServerName The name of the MCP server.
 * @param mcpServerConfig The configuration for the MCP server.
 * @param mcpClient The active MCP client instance.
 * @returns A promise that resolves to an array of discovered and enabled tools.
 * @throws An error if no enabled tools are found or if the server provides invalid function declarations.
 */
export async function discoverTools(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  mcpClient: Client,
): Promise<DiscoveredMCPTool[]> {
  try {
    const mcpCallableTool = mcpToTool(mcpClient);
    const tool = await mcpCallableTool.tool();

    if (!Array.isArray(tool.functionDeclarations)) {
      throw new Error(`Server did not return valid function declarations.`);
    }

    const discoveredTools: DiscoveredMCPTool[] = [];
    for (const funcDecl of tool.functionDeclarations) {
      if (!isEnabled(funcDecl, mcpServerName, mcpServerConfig)) {
        continue;
      }

      const toolNameForModel = generateValidName(funcDecl, mcpServerName);

      sanitizeParameters(funcDecl.parameters);

      discoveredTools.push(
        new DiscoveredMCPTool(
          mcpCallableTool,
          mcpServerName,
          toolNameForModel,
          funcDecl.description ?? '',
          funcDecl.parameters ?? { type: Type.OBJECT, properties: {} },
          funcDecl.name!,
          mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
          mcpServerConfig.trust,
        ),
      );
    }
    if (discoveredTools.length === 0) {
      throw Error('No enabled tools found');
    }
    return discoveredTools;
  } catch (error) {
    throw new Error(`Error discovering tools: ${error}`);
  }
}

/**
 * Creates and connects an MCP client to a server based on the provided configuration.
 * It determines the appropriate transport (Stdio, SSE, or Streamable HTTP) and
 * establishes a connection. It also applies a patch to handle request timeouts.
 *
 * @param mcpServerName The name of the MCP server, used for logging and identification.
 * @param mcpServerConfig The configuration specifying how to connect to the server.
 * @param toolRegistry The tool registry to register discovered tools with.
 * @param debugMode Whether to enable debug mode for the connection.
 * @returns A promise that resolves to a connected MCP `Client` instance.
 * @throws An error if the connection fails or the configuration is invalid.
 */
export async function connectToMcpServer(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  toolRegistry: ToolRegistry,
  debugMode: boolean,
): Promise<Client> {
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

  // Set up error handler for OAuth authentication errors
  mcpClient.onerror = (error) => {
    console.error(`MCP ERROR (${mcpServerName}):`, error.toString());

    // Check if this is an authentication error for OAuth-enabled servers
    if (
      mcpServerConfig.oauth?.enabled &&
      (error.toString().includes('401') ||
        error.toString().includes('Unauthorized') ||
        error.toString().includes('authentication'))
    ) {
      console.error(
        `Authentication error for MCP server '${mcpServerName}'. ` +
          `Please re-authenticate using: /mcp auth ${mcpServerName}`,
      );
    }

    // Update status to disconnected on error
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
  };

  let transport: Transport | null = null;
  
  try {
    // First try to create transport with OAuth if available
    const hasOAuthConfig = mcpServerConfig.oauth?.enabled;
    let accessToken: string | null = null;

    if (hasOAuthConfig && mcpServerConfig.oauth) {
      accessToken = await MCPOAuthProvider.getValidToken(
        mcpServerName,
        mcpServerConfig.oauth,
      );
    } else {
      // Check if we have stored OAuth tokens for this server
      const credentials = await MCPOAuthTokenStorage.getToken(mcpServerName);
      if (credentials) {
        accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
          clientId: credentials.clientId,
        });
      }
    }

    if (accessToken) {
      // Create transport with OAuth token
      transport = await createTransportWithOAuth(
        mcpServerName,
        mcpServerConfig,
        accessToken,
      );
      if (!transport) {
        // Fall back to regular transport if OAuth transport creation fails
        transport = createTransport(mcpServerName, mcpServerConfig, debugMode);
      }
    } else {
      // Create regular transport without OAuth
      transport = createTransport(mcpServerName, mcpServerConfig, debugMode);
    }

    // Set up stderr handler for StdioClientTransport
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
      await mcpClient.connect(transport, {
        timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
      });
      return mcpClient;
    } catch (error) {
      await transport.close();
      throw error;
    }
  } catch (error) {
    // Handle 401 errors that might indicate OAuth is required
    const errorString = String(error);
    if (
      errorString.includes('401') &&
      (mcpServerConfig.httpUrl || mcpServerConfig.url)
    ) {
      mcpServerRequiresOAuth.set(mcpServerName, true);
      
      // Try to extract www-authenticate header from the error
      const wwwAuthenticate = extractWWWAuthenticateHeader(errorString);
      
      if (wwwAuthenticate) {
        console.log(
          `Received 401 with www-authenticate header for server '${mcpServerName}'`,
        );
        // Try automatic OAuth discovery and authentication
        const oauthSuccess = await handleAutomaticOAuth(
          mcpServerName,
          mcpServerConfig,
          wwwAuthenticate,
        );
        if (oauthSuccess) {
          // Retry connection with OAuth token
          console.log(
            `Retrying connection to '${mcpServerName}' with OAuth token...`,
          );

          // Get the valid token - we need to create a proper OAuth config
          // The token should already be available from the authentication process
          const credentials =
            await MCPOAuthTokenStorage.getToken(mcpServerName);
          if (credentials) {
            const accessToken = await MCPOAuthProvider.getValidToken(
              mcpServerName,
              {
                // Pass client ID if available
                clientId: credentials.clientId,
              },
            );

            if (accessToken) {
              // Create transport with OAuth token
              const oauthTransport = await createTransportWithOAuth(
                mcpServerName,
                mcpServerConfig,
                accessToken,
              );
              if (oauthTransport) {
                try {
                  await mcpClient.connect(oauthTransport, {
                    timeout:
                      mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
                  });
                  // Connection successful with OAuth
                  updateMCPServerStatus(
                    mcpServerName,
                    MCPServerStatus.CONNECTED,
                  );
                  transport = oauthTransport; // Use the OAuth transport for the rest of the function
                } catch (retryError) {
                  console.error(
                    `Failed to connect with OAuth token: ${getErrorMessage(
                      retryError,
                    )}`,
                  );
                  updateMCPServerStatus(
                    mcpServerName,
                    MCPServerStatus.DISCONNECTED,
                  );
                  throw new Error(
                    `Failed to connect with OAuth token: ${getErrorMessage(
                      retryError,
                    )}`,
                  );
                }
              } else {
                console.error(
                  `Failed to create OAuth transport for server '${mcpServerName}'`,
                );
                updateMCPServerStatus(
                  mcpServerName,
                  MCPServerStatus.DISCONNECTED,
                );
                throw new Error(
                  `Failed to create OAuth transport for server '${mcpServerName}'`,
                );
              }
            } else {
              console.error(
                `Failed to get OAuth token for server '${mcpServerName}'`,
              );
              updateMCPServerStatus(
                mcpServerName,
                MCPServerStatus.DISCONNECTED,
              );
              throw new Error(
                `Failed to get OAuth token for server '${mcpServerName}'`,
              );
            }
          }
        } else {
          console.error(
            `Failed to handle automatic OAuth for server '${mcpServerName}'`,
          );
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
          throw new Error(
            `Failed to handle automatic OAuth for server '${mcpServerName}'`,
          );
        }
      } else {
        // No www-authenticate header found, but we got a 401
        // Only try OAuth discovery for HTTP servers or when OAuth is explicitly configured
        // For SSE servers, we should not trigger new OAuth flows automatically
        const shouldTryDiscovery =
          mcpServerConfig.httpUrl || mcpServerConfig.oauth?.enabled;

        if (!shouldTryDiscovery) {
          const credentials =
            await MCPOAuthTokenStorage.getToken(mcpServerName);
          if (credentials) {
            const hasStoredTokens = await MCPOAuthProvider.getValidToken(
              mcpServerName,
              {
                // Pass client ID if available
                clientId: credentials.clientId,
              },
            );
            if (hasStoredTokens) {
              console.log(
                `Stored OAuth token for SSE server '${mcpServerName}' was rejected. ` +
                  `Please re-authenticate using: /mcp auth ${mcpServerName}`,
              );
            } else {
              console.log(
                `401 error received for SSE server '${mcpServerName}' without OAuth configuration. ` +
                  `Please authenticate using: /mcp auth ${mcpServerName}`,
              );
            }
          }
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
          throw new Error(
            `401 error received for SSE server '${mcpServerName}' without OAuth configuration`,
          );
        }

        // For SSE servers, try to discover OAuth configuration from the base URL
        console.log(
          `401 error received but no www-authenticate header found, attempting OAuth discovery from base URL...`,
        );

        if (mcpServerConfig.url) {
          const sseUrl = new URL(mcpServerConfig.url);
          const baseUrl = `${sseUrl.protocol}//${sseUrl.host}`;

          try {
            // Try to discover OAuth configuration from the base URL
            const oauthConfig = await discoverOAuthConfig(baseUrl);
            if (oauthConfig) {
              console.log(
                `Discovered OAuth configuration from base URL for server '${mcpServerName}'`,
              );

              // Create OAuth configuration for authentication
              const oauthAuthConfig = {
                enabled: true,
                authorizationUrl: oauthConfig.authorizationUrl,
                tokenUrl: oauthConfig.tokenUrl,
                scopes: oauthConfig.scopes || [],
              };

              // Perform OAuth authentication
              console.log(
                `Starting OAuth authentication for server '${mcpServerName}'...`,
              );
              await MCPOAuthProvider.authenticate(
                mcpServerName,
                oauthAuthConfig,
              );

              // Retry connection with OAuth token
              const credentials =
                await MCPOAuthTokenStorage.getToken(mcpServerName);
              if (credentials) {
                const accessToken = await MCPOAuthProvider.getValidToken(
                  mcpServerName,
                  {
                    // Pass client ID if available
                    clientId: credentials.clientId,
                  },
                );
                if (accessToken) {
                  // Create transport with OAuth token
                  const oauthTransport = await createTransportWithOAuth(
                    mcpServerName,
                    mcpServerConfig,
                    accessToken,
                  );
                  if (oauthTransport) {
                    try {
                      await mcpClient.connect(oauthTransport, {
                        timeout:
                          mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
                      });
                      // Connection successful with OAuth
                      updateMCPServerStatus(
                        mcpServerName,
                        MCPServerStatus.CONNECTED,
                      );
                      transport = oauthTransport; // Use the OAuth transport for the rest of the function
                    } catch (retryError) {
                      console.error(
                        `Failed to connect with OAuth token: ${getErrorMessage(
                          retryError,
                        )}`,
                      );
                      updateMCPServerStatus(
                        mcpServerName,
                        MCPServerStatus.DISCONNECTED,
                      );
                      throw new Error(
                        `Failed to connect with OAuth token: ${getErrorMessage(
                          retryError,
                        )}`,
                      );
                    }
                  } else {
                    console.error(
                      `Failed to create OAuth transport for server '${mcpServerName}'`,
                    );
                    updateMCPServerStatus(
                      mcpServerName,
                      MCPServerStatus.DISCONNECTED,
                    );
                    throw new Error(
                      `Failed to create OAuth transport for server '${mcpServerName}'`,
                    );
                  }
                } else {
                  console.error(
                    `Failed to get OAuth token for server '${mcpServerName}'`,
                  );
                  updateMCPServerStatus(
                    mcpServerName,
                    MCPServerStatus.DISCONNECTED,
                  );
                  throw new Error(
                    `Failed to get OAuth token for server '${mcpServerName}'`,
                  );
                }
              }
            } else {
              console.error(
                `Failed to discover OAuth configuration from base URL for server '${mcpServerName}'`,
              );
              updateMCPServerStatus(
                mcpServerName,
                MCPServerStatus.DISCONNECTED,
              );
              throw new Error(
                `Failed to discover OAuth configuration from base URL for server '${mcpServerName}'`,
              );
            }
          } catch (discoveryError) {
            console.error(
              `Failed to discover OAuth configuration: ${getErrorMessage(discoveryError)}`,
            );
            updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
            throw new Error(
              `Failed to discover OAuth configuration: ${getErrorMessage(discoveryError)}`,
            );
          }
        } else {
          console.error(
            `401 error received but no www-authenticate header found and no URL for discovery`,
          );
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
          throw new Error(
            `401 error received but no www-authenticate header found and no URL for discovery`,
          );
        }
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
      throw new Error(errorString);
    }
  }

  mcpClient.onerror = (error) => {
    console.error(`MCP ERROR (${mcpServerName}):`, error.toString());

    // Check if this is an authentication error for OAuth-enabled servers
    if (
      mcpServerConfig.oauth?.enabled &&
      (error.toString().includes('401') ||
        error.toString().includes('Unauthorized') ||
        error.toString().includes('authentication'))
    ) {
      console.error(
        `Authentication error for MCP server '${mcpServerName}'. ` +
          `Please re-authenticate using: /mcp auth ${mcpServerName}`,
      );
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
      throw new Error(
        `MCP server '${mcpServerName}' did not return valid tool function declarations`,
      );
    }

    console.log(
      `Discovered ${tool.functionDeclarations.length} tools from MCP server '${mcpServerName}'`,
    ); // Add debug logging

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

  return mcpClient;
}

/** Visible for Testing */
export function createTransport(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  debugMode: boolean,
): Transport {
  if (mcpServerConfig.httpUrl) {
    const transportOptions: StreamableHTTPClientTransportOptions = {};
    if (mcpServerConfig.headers) {
      transportOptions.requestInit = {
        headers: mcpServerConfig.headers,
      };
    }
    return new StreamableHTTPClientTransport(
      new URL(mcpServerConfig.httpUrl),
      transportOptions,
    );
  }

  if (mcpServerConfig.url) {
    const transportOptions: SSEClientTransportOptions = {};
    if (mcpServerConfig.headers) {
      transportOptions.requestInit = {
        headers: mcpServerConfig.headers,
      };
    }
    return new SSEClientTransport(
      new URL(mcpServerConfig.url),
      transportOptions,
    );
  }

  if (mcpServerConfig.command) {
    const transport = new StdioClientTransport({
      command: mcpServerConfig.command,
      args: mcpServerConfig.args || [],
      env: {
        ...process.env,
        ...(mcpServerConfig.env || {}),
      } as Record<string, string>,
      cwd: mcpServerConfig.cwd,
      stderr: 'pipe',
    });
    if (debugMode) {
      transport.stderr!.on('data', (data) => {
        const stderrStr = data.toString().trim();
        console.debug(`[DEBUG] [MCP STDERR (${mcpServerName})]: `, stderrStr);
      });
    }
    return transport;
  }

  throw new Error(
    `Invalid configuration: missing httpUrl (for Streamable HTTP), url (for SSE), and command (for stdio).`,
  );
}

/** Visible for testing */
export function generateValidName(
  funcDecl: FunctionDeclaration,
  mcpServerName: string,
) {
  // Replace invalid characters (based on 400 error message from Gemini API) with underscores
  let validToolname = funcDecl.name!.replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Prepend MCP server name to avoid conflicts with other tools
  validToolname = mcpServerName + '__' + validToolname;

  // If longer than 63 characters, replace middle with '___'
  // (Gemini API says max length 64, but actual limit seems to be 63)
  if (validToolname.length > 63) {
    validToolname =
      validToolname.slice(0, 28) + '___' + validToolname.slice(-32);
  }
  return validToolname;
}

/** Visible for testing */
export function isEnabled(
  funcDecl: FunctionDeclaration,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): boolean {
  if (!funcDecl.name) {
    console.warn(
      `Discovered a function declaration without a name from MCP server '${mcpServerName}'. Skipping.`,
    );
    return false;
  }
  const { includeTools, excludeTools } = mcpServerConfig;

  // excludeTools takes precedence over includeTools
  if (excludeTools && excludeTools.includes(funcDecl.name)) {
    return false;
  }

  return (
    !includeTools ||
    includeTools.some(
      (tool) => tool === funcDecl.name || tool.startsWith(`${funcDecl.name}(`),
    )
  );
}
