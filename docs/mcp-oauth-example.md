# MCP OAuth Authentication Example

This document shows how to configure OAuth authentication for MCP servers in Gemini CLI.

## Configuration

Add an OAuth-enabled MCP server to your settings.json:

```json
{
  "mcpServers": {
    "secops": {
      "httpUrl": "https://mcp.raybrian.demo.altostrat.com/mcp",
      "oauth": {
        "enabled": true,
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "authorizationUrl": "https://mcp.raybrian.demo.altostrat.com/authorize",
        "tokenUrl": "https://mcp.raybrian.demo.altostrat.com/token",
        "scopes": ["secops:read", "chronicle:read"],
        "redirectUri": "http://localhost:7777/oauth/callback"
      },
      "description": "Google Security Operations MCP server"
    }
  }
}
```

## OAuth Configuration Fields

- `enabled`: Set to `true` to enable OAuth authentication
- `clientId`: OAuth client ID (required)
- `clientSecret`: OAuth client secret (optional, for confidential clients)
- `authorizationUrl`: Authorization endpoint URL
- `tokenUrl`: Token endpoint URL  
- `scopes`: Array of OAuth scopes to request
- `redirectUri`: Redirect URI for OAuth callback (defaults to `http://localhost:7777/oauth/callback`)

## Authentication Flow

1. Start Gemini CLI
2. Navigate to the MCP menu with `/mcp`
3. Authenticate with the server using `/mcp auth secops`
4. Your browser will open to the OAuth authorization page
5. Complete the login process
6. The browser will redirect back to Gemini CLI
7. Tokens are saved securely for future use

## Token Management

- Tokens are stored in `~/.gemini/mcp-oauth-tokens.json`
- Tokens are automatically refreshed when expired (if refresh token is available)
- To re-authenticate, use `/mcp auth <server-name>` again
- Tokens are encrypted at rest with restricted file permissions (0600)

## Troubleshooting

### Browser doesn't open
If the browser doesn't open automatically, copy the URL shown in the CLI and open it manually.

### Authentication errors
- Check that your OAuth configuration is correct
- Ensure the redirect URI is registered with your OAuth provider
- Check that the required scopes are available

### Token expiration
Tokens are automatically refreshed if a refresh token is available. If refresh fails, you'll need to re-authenticate.

## Security Considerations

- OAuth tokens are stored locally with restricted permissions
- Always use HTTPS for OAuth endpoints
- Keep your client secret secure (don't commit to version control)
- Use PKCE for additional security (automatically enabled) 