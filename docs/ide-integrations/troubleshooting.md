# IDE Integration Troubleshooting Guide

This guide helps diagnose and resolve common issues with the protocol-first IDE integrations in Gemini CLI using the Model Context Protocol (MCP).

## General Troubleshooting

### Enable Debug Mode

Always start troubleshooting by enabling debug mode to see detailed MCP communication logs:

```bash
gemini-cli --debug --ide-mode
```

This will show:

- MCP server discovery attempts
- Connection establishment details
- MCP tool calls and responses
- Server availability checks
- Error details and stack traces

### Check Integration Status

Use the `/ide status` command to see the current MCP integration state:

```bash
# In Gemini CLI
/ide status
```

Expected responses:
- `🟢 MCP Integration - Connected` - Working properly
- `🔴 No IDE integration active` - No MCP server found

## Common Issues

### 1. No IDE Integration Active

**Symptoms**:
- `/ide status` shows "🔴 No IDE integration active"
- Debug logs show "No MCP-compatible IDE found"

**Possible Causes & Solutions**:

#### A. MCP Server Not Running

**Check if your IDE's MCP server is running**:

```bash
# Check environment variable set by IDE extension
echo $GEMINI_CLI_IDE_SERVER_PORT

# Test MCP server directly
curl -X GET http://localhost:58767/mcp
# Should return HTTP 400 (expected for MCP discovery)
```

**Solutions**:
1. **VS Code**: Ensure companion extension is installed and enabled
2. **Other IDEs**: Verify your IDE extension/plugin is running the MCP server
3. **Custom IDEs**: Check that your MCP server implementation is correct

#### B. Environment Variable Not Set

The primary discovery method uses the `GEMINI_CLI_IDE_SERVER_PORT` environment variable:

```bash
# Check if environment variable is set
echo $GEMINI_CLI_IDE_SERVER_PORT

# Set manually if needed (replace 58767 with actual port)
export GEMINI_CLI_IDE_SERVER_PORT=58767
```

#### C. Port Not Accessible

**Check if the MCP server port is available**:

```bash
# Check what's listening on MCP ports
netstat -an | grep -E "(58767|3000|8080)"
lsof -i :58767

# Test connectivity
telnet localhost 58767
```

**Solutions**:
- Restart IDE extension/plugin
- Check firewall settings
- Try alternative ports (3000, 8080)
- Verify no other applications are using the port

### 2. MCP Server Discovery Issues

#### Wrong Port Detection

**Symptoms**:
- Connection timeouts
- "No MCP-compatible IDE server found" errors

**Debug Steps**:

```bash
# Test well-known ports manually
for port in 58767 3000 8080; do
  echo "Testing port $port..."
  curl -X GET http://localhost:$port/mcp --connect-timeout 2
done
```

**Solutions**:
1. Set `GEMINI_CLI_IDE_SERVER_PORT` explicitly
2. Configure your IDE extension to use a specific port
3. Check IDE extension logs for startup errors

#### MCP Server Not Responding Correctly

**Symptoms**:
- Server responds but Gemini CLI doesn't detect it
- HTTP errors other than 400 for GET requests

**Test MCP Server Response**:

```bash
# GET request should return HTTP 400
curl -X GET http://localhost:58767/mcp -v

# POST request should handle MCP calls
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
```

**Expected Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Active file: /path/to/file.ts (line: 10, char: 5)"
      }
    ]
  }
}
```

### 3. VS Code Extension Issues

#### Extension Not Starting MCP Server

**Symptoms**:
- `GEMINI_CLI_IDE_SERVER_PORT` not set in VS Code terminal
- Extension errors in VS Code output

**Debug Steps**:

1. Open VS Code Output panel (View → Output)
2. Select "Gemini CLI IDE Companion" from dropdown
3. Look for server startup logs and errors

**Common Solutions**:
- Restart VS Code completely
- Reinstall extension: `/ide install`
- Check VS Code version (requires 1.101.0+)
- Manually enable extension in Extensions panel

#### Port Conflicts

**Symptoms**:
- "Port already in use" in VS Code output
- Extension fails to start server

**Solutions**:

```bash
# Kill processes using the port
lsof -ti:58767 | xargs kill -9

# Or use alternative port by restarting VS Code
```

### 4. Custom IDE Integration Issues

#### MCP Tool Not Implemented

**Symptoms**:
- Connection established but "No file is currently active" always returned
- MCP tool call errors in debug logs

**Required Implementation**:

Your IDE's MCP server must implement the `getActiveFile` tool:

```typescript
// Tool definition
{
  name: "getActiveFile",
  description: "Get the currently active file and cursor position",
  inputSchema: {
    type: "object",
    properties: {}
  }
}

// Response format (choose one):
"Active file: /path/to/file.ts (line: 10, char: 5)"  // With cursor
"Active file: /path/to/file.ts"                       // Without cursor
"No file is currently active"                         // No file
```

#### Incorrect MCP Response Format

**Symptoms**:
- JSON parsing errors in debug logs
- "Invalid MCP response" messages

**Validate Response Format**:

```bash
# Test and validate JSON response
curl -X POST http://localhost:58767/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getActiveFile","arguments":{}}}' \
  | jq .
```

**Required Fields**:
- `jsonrpc: "2.0"`
- `id: <matching request id>`
- `result.content[0].type: "text"`
- `result.content[0].text: "<file info>"`

## Environment-Specific Issues

### macOS Issues

#### Security Restrictions

**Symptoms**:
- "App can't be opened" messages for IDE extensions
- Network permission dialogs

**Solutions**:
- Grant network permissions to IDE and extensions
- Allow extensions in Security & Privacy settings
- Use signed extensions when available

#### Localhost Resolution

**Symptoms**:
- Connection timeouts on localhost
- IPv6/IPv4 resolution issues

**Solutions**:

```bash
# Test both IPv4 and IPv6
curl -4 -X GET http://localhost:58767/mcp
curl -6 -X GET http://localhost:58767/mcp

# Use explicit IP if needed
curl -X GET http://127.0.0.1:58767/mcp
```

### Windows Issues

#### Firewall Blocking

**Symptoms**:
- Connection timeouts
- Windows Defender/Firewall alerts

**Solutions**:
- Add IDE and Gemini CLI to Windows Defender exclusions
- Configure firewall rules for localhost connections
- Run IDE as administrator if needed

#### Process Communication

**Symptoms**:
- Environment variables not inherited
- Extension processes fail to start

**Solutions**:

```powershell
# Check environment variables in PowerShell
Get-ChildItem Env: | Where-Object {$_.Name -like "*GEMINI*"}

# Set variables system-wide if needed
[Environment]::SetEnvironmentVariable("GEMINI_CLI_IDE_SERVER_PORT", "58767", "User")
```

### Linux Issues

#### Permission Issues

**Symptoms**:
- Port binding failures
- Socket permission errors

**Solutions**:

```bash
# Check user permissions
id
groups $USER

# Allow binding to port (if below 1024)
sudo setcap 'cap_net_bind_service=+ep' /path/to/ide

# Use user-space ports (>1024) instead
```

#### AppImage/Snap Restrictions

**Symptoms**:
- Environment variables not passed to sandboxed apps
- Network restrictions

**Solutions**:

```bash
# For Snap packages
snap connect ide-app:network

# For AppImage
./IDE.AppImage --env GEMINI_CLI_IDE_SERVER_PORT=58767

# Use native packages when possible
```

## Network and Connection Issues

### Connection Timeouts

**Symptoms**:
- "Connection timeout" errors in debug logs
- MCP server discovery fails

**Debug Steps**:

```bash
# Test connection with timeout
timeout 5s curl -X GET http://localhost:58767/mcp

# Check network latency
ping localhost

# Monitor network traffic
sudo tcpdump -i lo port 58767
```

**Solutions**:
- Increase timeout values in Gemini CLI
- Check for interfering VPN/proxy software
- Try different network interfaces
- Restart networking services

### HTTP Protocol Issues

**Symptoms**:
- Protocol mismatch errors
- SSL/TLS connection failures

**Solutions**:
- Ensure MCP server uses HTTP (not HTTPS) for localhost
- Check Content-Type headers in requests/responses
- Validate JSON-RPC 2.0 format compliance

## Performance Issues

### High Latency

**Symptoms**:
- Slow response to file changes
- Delayed active file detection

**Debug Steps**:

```bash
# Measure MCP call latency
time curl -X POST http://localhost:58767/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getActiveFile","arguments":{}}}'
```

**Solutions**:
- Optimize IDE extension implementation
- Use local caching for file information
- Implement connection pooling

### Resource Usage

**Symptoms**:
- High CPU usage from MCP server
- Memory leaks in IDE extensions

**Solutions**:
- Monitor MCP server resource usage
- Implement proper connection cleanup
- Use efficient polling strategies
- Cache responses when appropriate

## Advanced Debugging

### MCP Protocol Debugging

**Enable detailed MCP logging**:

```bash
# Set debug environment
export DEBUG=mcp:*
gemini-cli --debug --ide-mode
```

**Monitor MCP traffic**:

```bash
# HTTP proxy for MCP traffic inspection
mitmdump -s mcp_debug.py --listen-port 8080

# Configure IDE to use proxy (if supported)
export MCP_PROXY=http://localhost:8080
```

### IDE Extension Debugging

#### VS Code Extension

```javascript
// In extension console (Ctrl+Shift+P > Developer: Toggle Developer Tools)
console.log('MCP Server status:', mcpServer.isRunning());
console.log('Active file:', vscode.window.activeTextEditor?.document.fileName);
```

#### Custom Extensions

```bash
# Check extension logs
tail -f ~/.vscode/logs/*/exthost1/output_logging_*/extension-name.log

# Debug MCP server startup
node --inspect your-mcp-server.js
```

### Network Analysis

```bash
# Detailed packet capture
sudo tcpdump -i lo -s 0 -w mcp-traffic.pcap port 58767

# Analyze with Wireshark
wireshark mcp-traffic.pcap

# Real-time monitoring
netstat -c | grep 58767
```

## Configuration Issues

### Missing Configuration

**Check Gemini CLI configuration**:

```bash
# Find config file location
gemini-cli --help | grep -i config

# Check current settings
cat ~/.config/gemini-cli/settings.json

# Validate JSON
jq . ~/.config/gemini-cli/settings.json
```

**IDE Mode Settings**:

```json
{
  "ideMode": true,
  "ideIntegration": {
    "timeout": 10000,
    "debug": true
  }
}
```

### Environment Variable Conflicts

**Symptoms**:
- Wrong ports detected
- IDE misidentification

**Debug Steps**:

```bash
# Check all relevant environment variables
env | grep -E "(GEMINI|IDE|MCP|PORT)" | sort

# Check shell profile files
grep -r GEMINI_CLI ~/.bashrc ~/.zshrc ~/.profile
```

**Solutions**:
- Clear conflicting variables
- Set variables in IDE-specific profiles
- Use explicit port configuration

## Getting Help

### Collect Debug Information

When reporting issues, include:

1. **System Information**:
   ```bash
   uname -a
   gemini-cli --version
   echo $SHELL
   ```

2. **IDE Information**:
   ```bash
   # VS Code
   code --version
   
   # Generic
   which ide-executable
   ide-executable --version
   ```

3. **Network Status**:
   ```bash
   netstat -an | grep -E "(58767|3000|8080)"
   lsof -i :58767
   curl -v http://localhost:58767/mcp
   ```

4. **Environment Variables**:
   ```bash
   env | grep -E "(GEMINI|IDE|MCP)" > env.txt
   ```

5. **Debug Logs**:
   ```bash
   gemini-cli --debug --ide-mode > debug.log 2>&1
   ```

### Quick Diagnostic Script

```bash
#!/bin/bash
# ide-diagnostics.sh
echo "=== Gemini CLI IDE Integration Diagnostics ==="
echo "Date: $(date)"
echo

echo "--- System Info ---"
uname -a
echo "Gemini CLI: $(gemini-cli --version)"
echo "Shell: $SHELL"
echo

echo "--- Environment Variables ---"
env | grep -E "(GEMINI|IDE|MCP|TERM_PROGRAM)" | sort
echo

echo "--- Port Status ---"
for port in 58767 3000 8080; do
    echo "Port $port:"
    if lsof -i :$port 2>/dev/null; then
        echo "  In use"
    else
        echo "  Available"
    fi
    
    echo "  Connection test:"
    if timeout 2s curl -s -X GET http://localhost:$port/mcp >/dev/null 2>&1; then
        echo "    ✓ Responds"
    else
        echo "    ✗ No response"
    fi
    echo
done

echo "--- IDE Integration Status ---"
echo "/ide status" | gemini-cli --ide-mode --debug 2>&1 | head -20
```

### Common Solutions

**Quick Fixes**:

```bash
# Restart IDE integration
pkill -f "mcp.*server"
# Restart your IDE

# Reset environment
unset GEMINI_CLI_IDE_SERVER_PORT
export GEMINI_CLI_IDE_SERVER_PORT=58767

# Test manually
curl -X GET http://localhost:58767/mcp
```

**Reset to Defaults**:

```bash
# Stop all IDE processes
pkill -f "(code|idea|zed)"

# Clear environment
unset GEMINI_CLI_IDE_SERVER_PORT

# Restart IDE and test
gemini-cli --debug --ide-mode
```

### Report Issues

When reporting bugs, please:

1. Run the diagnostic script above
2. Include steps to reproduce
3. Specify your IDE and extension versions
4. Attach complete debug logs
5. Remove sensitive information from configs

File issues at the appropriate repository for your IDE integration.

Remember: The protocol-first architecture means most issues are related to MCP server implementation in IDE extensions rather than Gemini CLI itself. Check your IDE extension logs first!