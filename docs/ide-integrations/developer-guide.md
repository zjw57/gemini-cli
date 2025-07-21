# IDE Integration Developer Guide

This guide explains how to create IDE companion extensions/plugins for the Gemini CLI using the protocol-first architecture based on the Model Context Protocol (MCP).

## Overview

The Gemini CLI uses a protocol-first approach for IDE integration. Instead of creating IDE-specific integration code in Gemini CLI, you implement an MCP server in your IDE extension/plugin that communicates with Gemini CLI's generic MCP client.

This approach follows industry standards like the Language Server Protocol (LSP) and Debug Adapter Protocol (DAP).

## Architecture

The protocol-first architecture shifts IDE-specific logic to companion extensions:

```
┌─────────────────┐    MCP Protocol    ┌──────────────────────┐
│   Gemini CLI    │◄─────────────────► │ Your IDE Extension/  │
│  (IDE-agnostic) │     HTTP/WebSocket │ Plugin (MCP Server)  │
└─────────────────┘                    └──────────────────────┘
                                                │
                                                ▼
                                       ┌──────────────────────┐
                                       │ Your IDE             │
                                       │ (IntelliJ, Vim, etc.) │
                                       └──────────────────────┘
```

## Benefits of Protocol-First Approach

### For IDE Extension Developers

1. **Standard Protocol**: Implement MCP instead of custom Gemini CLI APIs
2. **Industry Pattern**: Follows LSP/DAP patterns developers already know
3. **Tool Reuse**: Your MCP server can work with other MCP clients
4. **Future-Proof**: Protocol evolution handled at MCP level
5. **No Core Changes**: Add IDE support without modifying Gemini CLI

### For Users

1. **Automatic Discovery**: Works when MCP server is detected
2. **Consistent Experience**: Same functionality across all IDEs
3. **Better Reliability**: Simpler architecture with fewer failure points

## Creating an IDE Integration

### Step 1: Implement MCP Server in Your IDE Extension

Your IDE extension/plugin needs to run an MCP server that implements the required tools and notifications.

#### Required MCP Tool: `getActiveFile`

```typescript
// Your MCP server must implement this tool
{
  name: "getActiveFile",
  description: "Get the currently active file and cursor position",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

#### Response Format

Your MCP server should return one of these formats:

```typescript
// With cursor position
'Active file: /path/to/file.ts (line: 10, char: 5)';

// Without cursor position
'Active file: /path/to/file.ts';

// No active file
'No file is currently active';
```

### Step 2: Set Up Environment Variables

Your extension should set the `GEMINI_CLI_IDE_SERVER_PORT` environment variable:

```bash
# Set this environment variable when your extension starts
export GEMINI_CLI_IDE_SERVER_PORT=58767
```

Gemini CLI will automatically discover MCP servers using:

1. The `GEMINI_CLI_IDE_SERVER_PORT` environment variable (primary)
2. Well-known ports: 58767, 3000, 8080 (fallback)

### Step 3: Handle File Change Notifications (Optional)

For real-time file change updates, implement MCP notifications:

```typescript
// Send this notification when the active file changes
{
  method: "activeFileNotification",
  params: {
    filePath?: string,
    cursor?: {
      line: number,
      character: number
    }
  }
}
```

## Implementation Examples

### Example 1: IntelliJ IDEA Plugin

```kotlin
// IntelliJ plugin that runs an MCP server
class GeminiCliMCPServer : ApplicationComponent {
    private var mcpServer: HttpServer? = null

    override fun initComponent() {
        // Start MCP server on port from environment or default
        val port = System.getenv("GEMINI_CLI_IDE_SERVER_PORT")?.toIntOrNull() ?: 58767
        startMCPServer(port)

        // Set environment variable for discovery
        System.setProperty("GEMINI_CLI_IDE_SERVER_PORT", port.toString())
    }

    private fun startMCPServer(port: Int) {
        mcpServer = HttpServer.create(InetSocketAddress(port), 0)

        // Implement getActiveFile tool
        mcpServer?.createContext("/mcp") { exchange ->
            when (exchange.requestMethod) {
                "POST" -> handleMCPRequest(exchange)
                "GET" -> {
                    // Return 400 for GET requests (MCP discovery pattern)
                    exchange.sendResponseHeaders(400, 0)
                    exchange.responseBody.close()
                }
            }
        }

        mcpServer?.start()
    }

    private fun handleMCPRequest(exchange: HttpExchange) {
        val request = exchange.requestBody.bufferedReader().readText()
        val mcpRequest = parseRequest(request)

        if (mcpRequest.method == "tools/call" &&
            mcpRequest.params.name == "getActiveFile") {

            val activeFile = getActiveFileFromIDE()
            val response = createMCPResponse(activeFile)

            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, response.length.toLong())
            exchange.responseBody.write(response.toByteArray())
            exchange.responseBody.close()
        }
    }

    private fun getActiveFileFromIDE(): String {
        val fileEditorManager = FileEditorManager.getInstance(project)
        val selectedEditor = fileEditorManager.selectedEditor as? TextEditor
        val virtualFile = selectedEditor?.editor?.virtualFile

        return if (virtualFile != null) {
            val filePath = virtualFile.path
            val editor = selectedEditor.editor
            val caretModel = editor.caretModel
            val line = caretModel.logicalPosition.line
            val char = caretModel.logicalPosition.column

            "Active file: $filePath (line: $line, char: $char)"
        } else {
            "No file is currently active"
        }
    }
}
```

### Example 2: Vim Plugin

```vim
" Vim plugin that starts MCP server
function! StartGeminiMCPServer()
    let l:port = $GEMINI_CLI_IDE_SERVER_PORT != "" ? $GEMINI_CLI_IDE_SERVER_PORT : 58767

    " Start Python MCP server
    let l:server_script = expand('<sfile>:p:h') . '/mcp_server.py'
    let l:job = job_start(['python3', l:server_script, l:port])

    " Set environment variable
    let $GEMINI_CLI_IDE_SERVER_PORT = l:port
endfunction

" Auto-start when Vim loads
autocmd VimEnter * call StartGeminiMCPServer()
```

```python
# mcp_server.py - Vim MCP server
import sys
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import vim

class MCPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Return 400 for GET requests (MCP discovery)
        self.send_response(400)
        self.end_headers()

    def do_POST(self):
        if self.path == '/mcp':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                request = json.loads(post_data.decode('utf-8'))
                response = self.handle_mcp_request(request)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()

    def handle_mcp_request(self, request):
        if (request.get('method') == 'tools/call' and
            request.get('params', {}).get('name') == 'getActiveFile'):

            # Get active file from Vim
            try:
                current_file = vim.current.buffer.name
                if current_file:
                    line = vim.current.window.cursor[0]
                    col = vim.current.window.cursor[1]
                    result = f"Active file: {current_file} (line: {line}, char: {col})"
                else:
                    result = "No file is currently active"

                return {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "content": [{"type": "text", "text": result}]
                    }
                }
            except:
                return {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "content": [{"type": "text", "text": "No file is currently active"}]
                    }
                }

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 58767
    server = HTTPServer(('localhost', port), MCPHandler)
    server.serve_forever()
```

### Example 3: VS Code Extension (Reference)

The existing VS Code extension serves as a reference implementation:

```typescript
// See packages/vscode-ide-companion/ for complete implementation
export class IDEServer {
  async start(port: number): Promise<void> {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Set environment variable for discovery
    process.env.GEMINI_CLI_IDE_SERVER_PORT = port.toString();

    // MCP endpoint
    app.all('/mcp', async (req, res) => {
      if (req.method === 'GET') {
        return res.status(400).end();
      }

      // Handle MCP requests
      const response = await this.handleMCPRequest(req.body);
      res.json(response);
    });

    this.server = app.listen(port, 'localhost');
  }

  private async handleMCPRequest(request: any): Promise<any> {
    if (
      request.method === 'tools/call' &&
      request.params?.name === 'getActiveFile'
    ) {
      const activeFile = this.getActiveFile();
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: activeFile }],
        },
      };
    }
  }
}
```

## Testing Your Integration

### 1. Test MCP Server Discovery

```bash
# Set environment variable
export GEMINI_CLI_IDE_SERVER_PORT=58767

# Start your IDE with MCP server
# Then test Gemini CLI discovery
gemini-cli --ide-mode
```

### 2. Test Active File Detection

```bash
# In Gemini CLI with IDE mode enabled
/ide status
# Should show: 🟢 MCP Integration - Connected
```

### 3. Manual MCP Testing

```bash
# Test your MCP server directly
curl -X GET http://localhost:58767/mcp
# Should return HTTP 400 (expected for MCP discovery)

curl -X POST http://localhost:58767/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "getActiveFile",
      "arguments": {}
    }
  }'
# Should return active file information
```

## Best Practices

### 1. Error Handling

Always handle errors gracefully in your MCP server:

```typescript
try {
  const activeFile = await getActiveFile();
  return createSuccessResponse(activeFile);
} catch (error) {
  console.error('Error getting active file:', error);
  return createErrorResponse('No file is currently active');
}
```

### 2. Port Management

Handle port conflicts gracefully:

```typescript
async function findAvailablePort(preferredPort: number): Promise<number> {
  // Try preferred port first, then find alternatives
  const ports = [preferredPort, 58767, 3000, 8080];
  for (const port of ports) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error('No available ports for MCP server');
}
```

### 3. Environment Variable Management

Set environment variables properly:

```typescript
// In your IDE extension initialization
const port = await startMCPServer();
process.env.GEMINI_CLI_IDE_SERVER_PORT = port.toString();

// Also set for child processes if needed
if (process.platform === 'win32') {
  // Windows-specific environment variable setting
} else {
  // Unix-like systems
}
```

### 4. Lifecycle Management

Clean up resources properly:

```typescript
// Extension deactivation
export function deactivate() {
  if (mcpServer) {
    mcpServer.close();
    mcpServer = null;
  }

  // Clear environment variable
  delete process.env.GEMINI_CLI_IDE_SERVER_PORT;
}
```

## Troubleshooting

### Common Issues

1. **Gemini CLI shows "No IDE integration active"**
   - Check environment variable: `echo $GEMINI_CLI_IDE_SERVER_PORT`
   - Test MCP server: `curl -X GET http://localhost:58767/mcp`
   - Verify port is accessible: `netstat -an | grep 58767`

2. **Connection timeouts**
   - Check firewall settings
   - Verify localhost binding
   - Try alternative ports

3. **MCP parsing errors**
   - Validate JSON response format
   - Check MCP specification compliance
   - Use debugging tools

### Debug Mode

Enable debug mode in Gemini CLI:

```bash
gemini-cli --ide-mode --debug
```

This will show detailed MCP communication logs.

## Contributing

When contributing IDE integrations:

1. **Follow MCP specification**: Ensure compliance with Model Context Protocol
2. **Test thoroughly**: Include unit tests and integration tests
3. **Document setup**: Provide clear installation and setup instructions
4. **Handle errors**: Implement proper error handling and logging
5. **Support discovery**: Use standard environment variable pattern

## Resources

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [VS Code Extension Reference](../../../packages/vscode-ide-companion/)
- [Architecture Documentation](./architecture.md)
- [Troubleshooting Guide](./troubleshooting.md)

## Future Enhancements

The protocol-first architecture supports future enhancements:

- **WebSocket MCP connections** for better performance
- **Bidirectional notifications** for real-time updates
- **Multi-workspace support** for complex projects
- **Language-specific context** for better suggestions
- **Debugging integration** for development workflows

By implementing MCP servers in IDE extensions, developers can provide rich Gemini CLI integration without requiring changes to the core CLI codebase.
