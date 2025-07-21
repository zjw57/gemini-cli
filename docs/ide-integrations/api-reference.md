# IDE Integration API Reference

This document provides detailed API reference for the protocol-first IDE integration system based on the Model Context Protocol (MCP).

## Overview

The IDE integration system follows a protocol-first architecture where Gemini CLI communicates with IDE companion extensions via the Model Context Protocol (MCP). This design eliminates the need for IDE-specific integration code in Gemini CLI core.

## Core Interfaces

### IDEIntegration

The main interface for MCP-based IDE integration. There is typically only one implementation that works with any MCP-compatible IDE.

```typescript
interface IDEIntegration {
  isAvailable(): Promise<boolean>;
  getActiveFileContext(): Promise<ActiveFileContext | null>;
  sendNotification(message: string): Promise<void>;
  setActiveFileChangeHandler(handler: (context: ActiveFileContext | null) => void): void;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}
```

#### Methods

##### `isAvailable(): Promise<boolean>`

Checks if an MCP-compatible IDE is currently available and can be connected to.

**Returns**: Promise that resolves to `true` if an MCP server is detected and responding.

**Implementation**: Tests connection to MCP servers discovered through:
- Environment variable `GEMINI_CLI_IDE_SERVER_PORT`  
- Well-known ports (58767, 3000, 8080)

##### `getActiveFileContext(): Promise<ActiveFileContext | null>`

Gets the currently active file context from the connected IDE via MCP.

**Returns**: Promise that resolves to `ActiveFileContext` or `null` if no file is active.

**MCP Implementation**: Calls the `getActiveFile` tool on the connected MCP server.

##### `sendNotification(message: string): Promise<void>`

Sends a notification to the connected IDE via MCP (if supported by the IDE).

**Parameters**:
- `message` - The message to send to the IDE

**Returns**: Promise that resolves when the notification is sent.

**MCP Implementation**: Uses MCP notifications if supported by the IDE's MCP server.

##### `setActiveFileChangeHandler(handler: (context: ActiveFileContext | null) => void): void`

Sets up a handler for active file change notifications from the IDE.

**Parameters**:
- `handler` - Callback function invoked when the active file changes

**MCP Implementation**: Listens for `activeFileNotification` messages from the MCP server.

##### `initialize(): Promise<void>`

Initializes the MCP connection to detect and connect to any available IDE.

**Returns**: Promise that resolves when MCP connection is established.

**Implementation**: 
1. Discovers available MCP servers
2. Establishes HTTP connection
3. Verifies required MCP tools are available

##### `cleanup(): Promise<void>`

Cleans up the MCP connection and resources.

**Returns**: Promise that resolves when cleanup is complete.

**Implementation**: Closes MCP client connections and cleans up event handlers.

### ActiveFileContext

Represents the context of the currently active file in an IDE.

```typescript
interface ActiveFileContext {
  filePath: string;
  cursor?: {
    line: number;
    character: number;
  };
}
```

#### Properties

##### `filePath: string`

The absolute path to the currently active file.

##### `cursor?: { line: number; character: number }`

Optional cursor position information.
- `line` - Zero-based line number
- `character` - Zero-based character position within the line

### IDEIntegrationConfig

Configuration object for creating IDE integrations.

```typescript
interface IDEIntegrationConfig {
  environment: Record<string, string | undefined>;
  timeout?: number;
  debug?: boolean;
}
```

#### Properties

##### `environment: Record<string, string | undefined>`

Environment variables that might be needed for the integration.

**Key Variables**:
- `GEMINI_CLI_IDE_SERVER_PORT` - Primary MCP server discovery method
- `TERM_PROGRAM` - IDE environment detection (legacy)

##### `timeout?: number`

Optional timeout for operations in milliseconds.

**Defaults**:
- Availability checks: 5000ms
- Initialization: 10000ms  
- Tool calls: 5000ms

##### `debug?: boolean`

Whether debug mode is enabled for detailed logging.

## Core Classes

### MCPIDEIntegration

The generic MCP-based IDE integration that works with any MCP-compatible IDE.

```typescript
class MCPIDEIntegration implements IDEIntegration {
  constructor(config: IDEIntegrationConfig);
  
  async isAvailable(): Promise<boolean>;
  async getActiveFileContext(): Promise<ActiveFileContext | null>;
  async sendNotification(message: string): Promise<void>;
  setActiveFileChangeHandler(handler: (context: ActiveFileContext | null) => void): void;
  async initialize(): Promise<void>;
  async cleanup(): Promise<void>;
}
```

**Usage**:
```typescript
const integration = new MCPIDEIntegration({
  environment: process.env,
  timeout: 5000,
  debug: true
});

await integration.initialize();
const context = await integration.getActiveFileContext();
```

### MCPTransport

Generic MCP transport that handles server discovery and communication.

```typescript
class MCPTransport {
  constructor(config: IDEIntegrationConfig);
  
  async isAvailable(): Promise<boolean>;
  async initialize(): Promise<void>;
  async getActiveFile(): Promise<ActiveFileContext | null>;
  setNotificationHandler(handler: (context: ActiveFileContext | null) => void): void;
  async sendNotification(message: string): Promise<void>;
  async cleanup(): Promise<void>;
}
```

#### Server Discovery

The transport uses multiple methods to discover MCP servers:

1. **Environment Variable** (Primary):
   ```typescript
   const port = config.environment.GEMINI_CLI_IDE_SERVER_PORT;
   ```

2. **Well-known Ports** (Fallback):
   ```typescript
   const wellKnownPorts = [58767, 3000, 8080];
   ```

3. **Connection Testing**:
   ```typescript
   // Test each discovered server
   const response = await fetch(`http://localhost:${port}/mcp`, {
     method: 'GET',
     timeout: 2000
   });
   // Expect HTTP 400 for MCP discovery
   ```

### IDEIntegrationManager

Simplified manager for the single MCP integration.

```typescript
class IDEIntegrationManager {
  async initialize(config: IDEIntegrationConfig): Promise<void>;
  async getStatus(): Promise<{ 
    active: boolean; 
    integration?: { type: string; available: boolean } 
  }>;
  async connectToMCP(config: IDEIntegrationConfig): Promise<boolean>;
  getActiveIntegration(): IDEIntegration | null;
  isActive(): boolean;
  async cleanup(): Promise<void>;
}
```

#### Status Response Format

```typescript
// No MCP integration available
{
  active: false
}

// MCP integration connected
{
  active: true,
  integration: {
    type: 'mcp',
    available: true
  }
}

// MCP integration detected but not responding
{
  active: true,
  integration: {
    type: 'mcp', 
    available: false
  }
}
```

## MCP Protocol Requirements

### Required MCP Tools

IDE MCP servers must implement the following tools:

#### `getActiveFile`

```typescript
{
  name: "getActiveFile",
  description: "Get the currently active file and cursor position",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

**Response Formats**:
```typescript
// With cursor position
"Active file: /path/to/file.ts (line: 10, char: 5)"

// Without cursor position  
"Active file: /path/to/file.ts"

// No active file
"No file is currently active"
```

**MCP Response Structure**:
```typescript
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

### Optional MCP Notifications

#### `activeFileNotification`

IDE MCP servers can send notifications when the active file changes:

```typescript
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

## Environment Setup

### For IDE Extension Developers

Set the environment variable when your MCP server starts:

```bash
# Primary discovery method
export GEMINI_CLI_IDE_SERVER_PORT=58767
```

Your extension should:
1. Start an MCP server on the specified port
2. Implement the required `getActiveFile` tool
3. Set the environment variable for discovery
4. Handle MCP tool calls with proper JSON-RPC 2.0 format

### For Gemini CLI Users

The integration is automatically detected when:
- An IDE companion extension is running an MCP server
- The server is accessible on a discoverable port
- The server implements required MCP tools

## Error Handling

### Connection Failures

```typescript
// Graceful degradation - IDE integration is optional
try {
  await integration.initialize();
} catch (error) {
  // Continue without IDE integration
  console.debug('IDE integration not available:', error.message);
}
```

### Tool Call Failures

```typescript
// Fallback to manual file specification
try {
  const context = await integration.getActiveFileContext();
  return context;
} catch (error) {
  // Prompt user for file path
  return null;
}
```

### Notification Failures

```typescript
// Notifications are non-critical
try {
  await integration.sendNotification(message);
} catch (error) {
  // Continue without notification
  console.debug('Notification failed:', error.message);
}
```

## Migration from Registry-Based System

The protocol-first architecture replaces the previous registry-based system:

### Removed Concepts

- `IDEIntegrationRegistry` - No longer needed
- `IDEIntegrationFactory` - Replaced by direct instantiation  
- IDE-specific integration classes - Replaced by generic MCP integration
- `id`, `name`, `description` properties - No longer relevant

### Migration Path

**Before** (Registry-based):
```typescript
const registry = new IDEIntegrationRegistry();
registry.register('vscode', vscodeFactory);
const integration = await registry.create('vscode', config);
```

**After** (Protocol-first):
```typescript
const integration = new MCPIDEIntegration(config);
await integration.initialize(); // Auto-discovers any MCP-compatible IDE
```

## Future Enhancements

The protocol-first architecture enables:

- **WebSocket MCP connections** for better performance
- **Bidirectional notifications** for real-time updates
- **Multi-workspace support** for complex projects  
- **Language-specific context** for better suggestions
- **Debugging integration** for development workflows

All enhancements can be implemented at the MCP protocol level without changes to Gemini CLI core.