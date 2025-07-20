# IDE Integration Troubleshooting Guide

This guide helps diagnose and resolve common issues with IDE integrations in Gemini CLI.

## General Troubleshooting

### Enable Debug Mode

Always start troubleshooting by enabling debug mode to see detailed logs:

```bash
gemini --debug --ide-mode
```

This will show:

- Integration detection attempts
- Connection status
- API calls and responses
- Error details and stack traces

### Check Integration Status

Use the `/ide status` command to see the current integration state:

```bash
# In Gemini CLI
/ide status
```

This shows:

- Available integrations
- Active integration
- Connection status
- Error messages

## Common Issues

### 1. No IDE Integration Active

**Symptoms**:

- `/ide status` shows "🔴 No IDE integration active"
- Debug logs show "No IDE integrations available"

**Possible Causes & Solutions**:

#### A. IDE Not Detected

```bash
# Check environment variables
echo $TERM_PROGRAM
echo $GEMINI_CLI_IDE_SERVER_PORT  # For VS Code
echo $IDEA_INITIAL_DIRECTORY      # For JetBrains
```

**Solutions**:

- Ensure you're running Gemini CLI from within the IDE's terminal
- Check that the IDE has set its environment variables
- Restart the IDE and try again

#### B. IDE Extension/Plugin Not Installed

**VS Code**: Install the Gemini CLI VS Code companion extension

```bash
/ide install  # Install VS Code extension
```

**JetBrains**: Install the Gemini Helper plugin from the marketplace

**Zed**: Install the Gemini Helper extension

#### C. IDE Mode Not Enabled

```bash
# Enable IDE mode explicitly
gemini --ide-mode
```

Or check your settings file for `"ideMode": true`

### 2. VS Code Integration Issues

#### Extension Not Starting

**Symptoms**:

- `GEMINI_CLI_IDE_SERVER_PORT` not set
- Extension shows errors in VS Code output

**Debug Steps**:

1. Open VS Code Output panel (View → Output)
2. Select "Gemini CLI IDE Companion" from dropdown
3. Check for error messages

**Common Solutions**:

- Restart VS Code
- Reinstall the extension: `/ide install`
- Check VS Code version compatibility (requires 1.101.0+)

#### Port Conflicts

**Symptoms**:

- "Port already in use" errors
- Random port assignment failures

**Solutions**:

```bash
# Check what's using the port
netstat -an | grep 58767  # Or whatever port is shown

# Kill conflicting processes
lsof -ti:58767 | xargs kill -9
```

#### Permission Issues

**Symptoms**:

- "Permission denied" errors
- HTTP requests failing

**Solutions**:

- Check firewall settings
- Ensure VS Code has network permissions
- Try running VS Code as administrator (Windows) or with sudo (rarely needed)

### 3. JetBrains Integration Issues

#### Plugin Not Found

**Symptoms**:

- No JetBrains environment variables detected
- Plugin not responding to requests

**Debug Steps**:

```bash
# Check JetBrains-specific environment
echo $IDEA_INITIAL_DIRECTORY
echo $PYCHARM_HOSTED
echo $WEBSTORM_VM_OPTIONS

# Check if plugin is running
curl http://localhost:8888/health
```

**Solutions**:

- Install the Gemini Helper plugin from JetBrains marketplace
- Restart the IDE after plugin installation
- Check plugin is enabled in Settings → Plugins

#### HTTP Server Issues

**Symptoms**:

- Connection timeouts
- HTTP 404 or 500 errors

**Solutions**:

- Check plugin logs in IDE
- Verify port 8888 is available
- Configure custom port if needed:
  ```bash
  export GEMINI_CLI_JETBRAINS_PORT=9999
  ```

### 4. Zed Integration Issues

#### LSP Server Not Found

**Symptoms**:

- "Zed LSP server not found" errors
- Process spawning failures

**Debug Steps**:

```bash
# Check if Zed LSP server exists
which zed-lsp
ls -la /usr/local/bin/zed-lsp

# Test LSP server manually
zed-lsp --test
```

**Solutions**:

- Install Zed with LSP components
- Set custom LSP server path:
  ```bash
  export ZED_LSP_SERVER_PATH=/custom/path/to/zed-lsp
  ```

#### Extension Loading Issues

**Symptoms**:

- Extension not active in Zed
- No response to LSP requests

**Solutions**:

- Check extension is installed and enabled
- Restart Zed editor
- Check Zed extension logs

## Environment-Specific Issues

### macOS Issues

#### Security Restrictions

**Symptoms**:

- "App can't be opened" messages
- Network permission dialogs

**Solutions**:

- Grant network permissions to Gemini CLI
- Allow unsigned extensions in Security settings
- Use `codesign` for custom LSP servers

#### Path Issues

**Symptoms**:

- Executables not found
- Environment variables not set

**Solutions**:

```bash
# Check PATH in IDE terminal vs system terminal
echo $PATH

# Add IDE paths to shell profile
export PATH="/Applications/Zed.app/Contents/MacOS:$PATH"
```

### Windows Issues

#### Firewall Blocking

**Symptoms**:

- Connection timeouts
- Windows Defender alerts

**Solutions**:

- Add Gemini CLI to Windows Defender exclusions
- Configure firewall rules for local connections
- Run as administrator if needed

#### Process Execution

**Symptoms**:

- "Access denied" when spawning processes
- LSP server won't start

**Solutions**:

- Check antivirus software blocking execution
- Verify executable permissions
- Use PowerShell instead of Command Prompt

### Linux Issues

#### AppImage/Snap Issues

**Symptoms**:

- Environment variables not passed
- Sandboxing restrictions

**Solutions**:

```bash
# For AppImage IDEs
./IDE.AppImage --env CUSTOM_VAR=value

# For Snap packages
snap connect package:network
```

#### Permission Issues

**Symptoms**:

- Socket creation failures
- File access denied

**Solutions**:

```bash
# Fix socket permissions
chmod 755 /tmp/ide-socket

# Check user groups
groups $USER
```

## Network and Connection Issues

### Connection Timeouts

**Symptoms**:

- "Connection timeout" errors
- Slow response times

**Debug Steps**:

```bash
# Test connection manually
curl -v http://localhost:8888/health
telnet localhost 8888
```

**Solutions**:

- Increase timeout values in settings
- Check network interfaces:
  ```bash
  netstat -rn  # Check routing table
  ```
- Try different ports
- Disable VPN if causing issues

### SSL/TLS Issues

**Symptoms**:

- Certificate errors
- HTTPS connection failures

**Solutions**:

- Use HTTP instead of HTTPS for local connections
- Add self-signed certificates to trust store
- Disable SSL verification (development only)

## Performance Issues

### High CPU Usage

**Symptoms**:

- IDE becomes slow
- Gemini CLI uses excessive CPU

**Debug Steps**:

```bash
# Monitor resource usage
top -p $(pgrep gemini)
ps aux | grep ide

# Check polling frequency
# Look for excessive API calls in debug logs
```

**Solutions**:

- Increase polling intervals
- Optimize file change detection
- Disable unnecessary features

### Memory Leaks

**Symptoms**:

- Memory usage increasing over time
- Out of memory errors

**Solutions**:

- Restart IDE integration periodically
- Check for unclosed connections
- Update to latest versions

## Configuration Issues

### Settings Not Applied

**Symptoms**:

- Custom settings ignored
- Default values used instead

**Debug Steps**:

```bash
# Check settings file location
ls -la ~/.config/gemini-cli/
cat ~/.config/gemini-cli/settings.json

# Verify JSON syntax
jq . ~/.config/gemini-cli/settings.json
```

**Solutions**:

- Fix JSON syntax errors
- Check file permissions
- Use absolute paths in configuration

### Environment Variable Conflicts

**Symptoms**:

- Wrong IDE detected
- Conflicting port assignments

**Debug Steps**:

```bash
# List all relevant environment variables
env | grep -E "(TERM_PROGRAM|GEMINI_CLI|IDE|VSCODE|IDEA|ZED)"
```

**Solutions**:

- Unset conflicting variables
- Use IDE-specific terminals
- Set variables explicitly:
  ```bash
  unset CONFLICTING_VAR
  export GEMINI_CLI_IDE_SERVER_PORT=8080
  ```

## Advanced Debugging

### Packet Capture

For network communication issues:

```bash
# Capture HTTP traffic
sudo tcpdump -i lo port 8888 -A

# Use Wireshark for GUI analysis
wireshark -i lo -f "port 8888"
```

### Process Monitoring

```bash
# Monitor process creation
sudo dtruss -fn gemini  # macOS
sudo strace -f -e trace=execve gemini  # Linux

# Monitor file access
sudo fs_usage -w | grep gemini  # macOS
sudo inotifywait -m /path/to/watch  # Linux
```

### Log Analysis

```bash
# Search for specific errors
grep -i "error\|fail\|timeout" ~/.local/share/gemini-cli/logs/*

# Monitor logs in real-time
tail -f ~/.local/share/gemini-cli/logs/debug.log
```

## Getting Help

### Collect Debug Information

When reporting issues, include:

1. **System Information**:

   ```bash
   uname -a
   gemini --version
   code --version  # For VS Code issues
   ```

2. **Environment Variables**:

   ```bash
   env | grep -E "(TERM_PROGRAM|GEMINI_CLI|IDE)" > env.txt
   ```

3. **Debug Logs**:

   ```bash
   gemini --debug --ide-mode > debug.log 2>&1
   ```

4. **Network Status**:
   ```bash
   netstat -an | grep 8888
   lsof -i :8888
   ```

### Common Debug Commands

```bash
# Quick diagnostics
/ide status
gemini --debug --ide-mode
curl http://localhost:8888/health

# Process information
ps aux | grep -E "(gemini|code|idea|zed)"

# Network diagnostics
netstat -tulpn | grep 8888
ss -tulpn | grep 8888

# File permissions
ls -la ~/.config/gemini-cli/
ls -la /tmp/ide-socket
```

### Reset to Defaults

If all else fails, reset the configuration:

```bash
# Backup current config
cp ~/.config/gemini-cli/settings.json ~/.config/gemini-cli/settings.json.bak

# Remove custom settings
rm ~/.config/gemini-cli/settings.json

# Clear environment variables
unset GEMINI_CLI_IDE_SERVER_PORT
unset GEMINI_CLI_JETBRAINS_PORT

# Restart with clean state
gemini --ide-mode
```

### Report Bugs

When reporting bugs, please include:

1. Steps to reproduce the issue
2. Expected vs actual behavior
3. System information (OS, IDE version, Gemini CLI version)
4. Complete debug logs
5. Configuration files (remove sensitive information)

File issues at: https://github.com/anthropics/claude-code/issues

## Performance Tuning

### Optimize Polling Intervals

```json
{
  "ideIntegration": {
    "pollingInterval": 2000,
    "connectionTimeout": 5000,
    "maxRetries": 3
  }
}
```

### Reduce Resource Usage

```json
{
  "ideIntegration": {
    "enableFileWatching": false,
    "enableNotifications": false,
    "cacheResponses": true
  }
}
```

### Connection Pooling

```json
{
  "ideIntegration": {
    "keepAliveConnections": true,
    "maxConnections": 5,
    "connectionPoolTimeout": 30000
  }
}
```

Remember: Always check the debug logs first, as they contain the most detailed information about what's happening during integration attempts.
