# MCP OAuth Authentication in Gemini CLI

This document describes the OAuth authentication support for MCP (Model Context Protocol) servers in Gemini CLI.

## Overview

Gemini CLI now supports OAuth 2.0 authentication for MCP servers that require it. This implementation follows the MCP OAuth specification and supports:

- Authorization Code flow with PKCE
- Automatic token refresh
- Secure token storage
- Dynamic OAuth discovery
- Multiple OAuth-enabled servers

## Quick Start

1. **Configure an OAuth-enabled MCP server** in your `settings.json`:

```json
{
  "mcpServers": {
    "my-secure-server": {
      "httpUrl": "https://example.com/mcp",
      "oauth": {
        "enabled": true,
        "clientId": "your-client-id",
        "authorizationUrl": "https://example.com/authorize",
        "tokenUrl": "https://example.com/token",
        "scopes": ["read", "write"]
      }
    }
  }
}
```

2. **Start Gemini CLI** and authenticate:
```bash
gemini

# In the CLI:
/mcp auth my-secure-server
```

3. **Complete the OAuth flow** in your browser and return to the CLI.

## Configuration

### Required OAuth Fields

- `enabled`: Set to `true` to enable OAuth for this server
- `clientId`: Your OAuth client ID
- `authorizationUrl`: The authorization endpoint URL
- `tokenUrl`: The token endpoint URL

### Optional OAuth Fields

- `clientSecret`: OAuth client secret (for confidential clients)
- `scopes`: Array of OAuth scopes to request
- `redirectUri`: Custom redirect URI (defaults to `http://localhost:7777/oauth/callback`)

## Features

### Automatic Token Management

- Tokens are stored securely in `~/.gemini/mcp-oauth-tokens.json`
- File permissions are restricted to 0600 (owner read/write only)
- Tokens are automatically refreshed when expired (if refresh token available)

### OAuth Status Display

View authentication status for all MCP servers:
```
/mcp
```

This shows:
- Connection status (Connected/Disconnected/Connecting)
- OAuth authentication status
- Token expiration status

### Re-authentication

To re-authenticate with a server:
```
/mcp auth <server-name>
```

### List OAuth-enabled Servers

To see which servers require OAuth:
```
/mcp auth
```

## Security Features

### PKCE (Proof Key for Code Exchange)

All OAuth flows use PKCE for enhanced security, even for confidential clients.

### State Parameter

CSRF protection via state parameter validation.

### Secure Token Storage

- Tokens stored with restricted file permissions
- Tokens never logged or displayed
- Expired tokens automatically cleaned up

### HTTPS Enforcement

OAuth endpoints must use HTTPS (except for localhost during development).

## Troubleshooting

### Browser doesn't open

If the browser doesn't open automatically:
1. Copy the URL shown in the CLI
2. Open it manually in your browser
3. Complete the authentication
4. Return to the CLI

### Port 7777 in use

The default callback port is 7777. If it's in use, configure a custom redirect URI:

```json
{
  "oauth": {
    "redirectUri": "http://localhost:8888/oauth/callback"
  }
}
```

### Token expired

Tokens are automatically refreshed if a refresh token is available. If refresh fails:
1. Check your network connection
2. Re-authenticate using `/mcp auth <server-name>`

### Authentication errors

Common causes:
- Invalid client ID or secret
- Incorrect OAuth URLs
- Missing required scopes
- Redirect URI not registered with OAuth provider

## Advanced Usage

### Dynamic Client Registration

If the OAuth server supports dynamic client registration, you can omit the `clientId`:

```json
{
  "oauth": {
    "enabled": true,
    "authorizationUrl": "https://example.com/authorize",
    "tokenUrl": "https://example.com/token"
  }
}
```

The CLI will attempt to register a client automatically.

### OAuth Discovery

For servers that support OAuth discovery, you can use minimal configuration:

```json
{
  "mcpServers": {
    "auto-discover": {
      "httpUrl": "https://example.com/mcp"
    }
  }
}
```

The CLI will:
1. Check for OAuth requirements when connecting
2. Discover OAuth endpoints automatically
3. Prompt for authentication if needed

### Multiple OAuth Servers

You can configure multiple OAuth-enabled servers:

```json
{
  "mcpServers": {
    "server1": {
      "httpUrl": "https://api1.example.com/mcp",
      "oauth": { ... }
    },
    "server2": {
      "httpUrl": "https://api2.example.com/mcp",
      "oauth": { ... }
    }
  }
}
```

Each server maintains its own tokens independently.

## Implementation Details

### OAuth Flow

1. User initiates authentication with `/mcp auth <server>`
2. CLI generates PKCE parameters
3. Browser opens to authorization URL
4. User completes authentication
5. OAuth provider redirects to local callback server
6. CLI exchanges authorization code for tokens
7. Tokens are securely stored
8. MCP connection uses Bearer token authentication

### Token Refresh

1. Before each request, token expiration is checked
2. If expired and refresh token exists, automatic refresh attempted
3. New tokens replace old ones
4. If refresh fails, user prompted to re-authenticate

### Error Handling

- 401 Unauthorized: Triggers re-authentication prompt
- Network errors: Logged with suggestions
- Invalid tokens: Automatically removed
- Expired tokens: Automatic refresh attempted

## Compliance

This implementation follows:
- OAuth 2.1 draft specification
- MCP OAuth authorization specification
- RFC 7636 (PKCE)
- RFC 8414 (Authorization Server Metadata)
- RFC 9728 (Protected Resource Metadata) 