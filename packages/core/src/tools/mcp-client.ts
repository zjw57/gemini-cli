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
import { discoverOAuthConfig, parseWWWAuthenticateHeader } from '../mcp/oauth-discovery.js';
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
  wwwAuthenticate: string
): Promise<boolean> {
  try {
    console.log(`MCP server '${mcpServerName}' requires OAuth. Discovering configuration...`);
    
    // The server URL is the primary source for discovery.
    // The wwwAuthenticate header can provide a direct link to the resource metadata.
    const resourceMetadataUri = parseWWWAuthenticateHeader(wwwAuthenticate);
    const discoveryUrl = resourceMetadataUri || mcpServerConfig.url;

    if (!discoveryUrl) {
      console.error(`Cannot discover OAuth for '${mcpServerName}': no URL provided.`);
      return false;
    }
    
    const oauthConfig = await discoverOAuthConfig(discoveryUrl);
    
    if (!oauthConfig) {
      console.error(`Failed to discover OAuth configuration for server '${mcpServerName}'.`);
      return false;
    }
    
    console.log(`Discovered OAuth configuration for server '${mcpServerName}':`);
    console.log(`  Authorization URL: ${oauthConfig.authorizationUrl}`);
    console.log(`  Token URL: ${oauthConfig.tokenUrl}`);
    console.log(`  Scopes: ${(oauthConfig.scopes || []).join(', ')}`);
    
    // The MCPOAuthProvider will handle the full authentication flow.
    // We pass the discovered config to it.
    await MCPOAuthProvider.authenticate(mcpServerName, oauthConfig);
    
    console.log(`OAuth authentication successful for server '${mcpServerName}'`);
    return true;
  } catch (error) {
    console.error(`Failed to handle automatic OAuth for server '${mcpServerName}': ${getErrorMessage(error)}`);
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
  accessToken: string
): Promise<StreamableHTTPClientTransport | SSEClientTransport | null> {
  try {
    if (mcpServerConfig.httpUrl) {
      // Create HTTP transport with OAuth token
      const oauthTransportOptions: StreamableHTTPClientTransportOptions = {
        requestInit: {
          headers: {
            ...mcpServerConfig.headers,
            'Authorization': `Bearer ${accessToken}`,
          },
        },
      };
      
      return new StreamableHTTPClientTransport(
        new URL(mcpServerConfig.httpUrl),
        oauthTransportOptions,
      );
    } else if (mcpServerConfig.url) {
      // Create SSE transport with OAuth token
      const sseUrl = new URL(mcpServerConfig.url);
      const tokenParamName = mcpServerConfig.oauth?.tokenParamName || 'access_token';
      sseUrl.searchParams.set(tokenParamName, accessToken);
      return new SSEClientTransport(sseUrl);
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to create OAuth transport for server '${mcpServerName}': ${getErrorMessage(error)}`);
    return null;
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
  if (mcpServerConfig.url) {
    // All HTTP-based servers (including those that use SSE for streaming)
    // are handled by the StreamableHTTPClientTransport.
    const transportOptions: StreamableHTTPClientTransportOptions = {};

    // Check for a stored OAuth token and add it to the headers if present.
    const accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
      authorizationUrl: '', // Discovery will handle this
      tokenUrl: '',       // Discovery will handle this
    });

    if (accessToken) {
      console.log(`Found stored OAuth token for server '${mcpServerName}'. Adding to headers.`);
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

    transport = new StreamableHTTPClientTransport(
      new URL(mcpServerConfig.url),
      transportOptions,
    );
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
      `MCP server '${mcpServerName}' has invalid configuration: missing url (for HTTP/SSE) or command (for stdio). Skipping.`,
    );
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
      // Check if this is a 401 error that might indicate OAuth is required.
      const errorString = String(error);
      if (errorString.includes('401') && mcpServerConfig.url) {
        console.log(`Received 401 for server '${mcpServerName}'. Attempting automatic OAuth flow...`);
        // Try to extract the www-authenticate header from the error to get the resource metadata URI.
        const wwwAuthenticate = extractWWWAuthenticateHeader(errorString);
        
        // If the header is present, use it for discovery. Otherwise, the discovery
        // will fall back to the well-known endpoint.
        const oauthSuccess = await handleAutomaticOAuth(mcpServerName, mcpServerConfig, wwwAuthenticate || '');
        if (oauthSuccess) {
          // If auth was successful, we need to reconnect. The tool registry will trigger this.
          // For now, we just mark as disconnected and let the user re-run the command.
          // A more advanced implementation could automatically retry the original command.
          console.log(`OAuth successful for '${mcpServerName}'. Please try your action again.`);
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED); // This will allow reconnection
          return;
        } else {
          console.error(`Automatic OAuth flow failed for server '${mcpServerName}'.`);
          updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
          return;
        }
      } else {
        // Handle other connection errors
        const safeConfig = {
          command: mcpServerConfig.command,
          url: mcpServerConfig.url,
          cwd: mcpServerConfig.cwd,
          timeout: mcpServerConfig.timeout,
          trust: mcpServerConfig.trust,
        };

        let errorMsg =
          `Failed to start or connect to MCP server '${mcpServerName}' ` +
          `${JSON.stringify(safeConfig)}; \n${getErrorMessage(error)}`;
        if (process.env.SANDBOX) {
          errorMsg += `\nMake sure it is available in the sandbox`;
        }
        console.error(errorMsg);
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
