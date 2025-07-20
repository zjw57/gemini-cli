# IDE Integration Developer Guide

This guide explains how to create new IDE integrations for the Gemini CLI using the extensible plugin system.

## Overview

The Gemini CLI supports IDE integrations through a plugin-based architecture that allows adding support for new editors and IDEs. The system is designed to be extensible while maintaining a consistent interface.

## Architecture

The IDE integration system consists of three main layers:

1. **IDE Integration Manager** - Coordinates all IDE integrations
2. **IDE Integration Implementation** - Editor-specific logic
3. **Transport Layer** - Communication protocol (typically MCP over HTTP)

```
┌─────────────────────────────────────────────────────────────┐
│                    Gemini CLI Core                          │
├─────────────────────────────────────────────────────────────┤
│              IDE Integration Manager                        │
├─────────────────────────────────────────────────────────────┤
│    VS Code Integration    │   JetBrains Integration         │
│                           │   (your implementation)         │
├─────────────────────────────────────────────────────────────┤
│    MCP Transport          │   Custom Transport              │
├─────────────────────────────────────────────────────────────┤
│    VS Code Extension      │   JetBrains Plugin              │
└─────────────────────────────────────────────────────────────┘
```

## Creating a New IDE Integration

### Step 1: Implement the IDEIntegration Interface

Create a new class that implements the `IDEIntegration` interface:

```typescript
import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from '../types.js';

export class JetBrainsIntegration implements IDEIntegration {
  readonly id = 'jetbrains';
  readonly name = 'JetBrains IDEs';
  readonly description =
    'IntelliJ IDEA, PyCharm, or WebStorm integration (for example, only)';

  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // Check if JetBrains IDE is running and reachable
    // This might involve checking for specific environment variables,
    // attempting to connect to a known port, or checking process lists
    return false; // Implement your detection logic
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    // Get the currently active file from the JetBrains IDE
    // Return file path and cursor position
    return null; // Implement your file detection logic
  }

  async sendNotification(message: string): Promise<void> {
    // Send a notification to the JetBrains IDE (optional)
    // This could show a popup, status bar message, etc.
  }

  async initialize(): Promise<void> {
    // Set up connection to JetBrains IDE
    // Initialize any required communication channels
  }

  async cleanup(): Promise<void> {
    // Clean up resources, close connections
  }
}
```

### Step 2: Create an Integration Factory

Create a factory function to instantiate your integration:

```typescript
import { IDEIntegrationFactory } from '../types.js';
import { JetBrainsIntegration } from './jetbrainsIntegration.js';

export const jetbrainsIntegrationFactory: IDEIntegrationFactory = (config) => {
  return new JetBrainsIntegration(config);
};
```

### Step 3: Register Your Integration

Add your integration to the IDE Integration Manager:

```typescript
// In ideIntegrationManager.ts or a plugin loader
import { jetbrainsIntegrationFactory } from './jetbrains/index.js';

// During initialization
if (!ideIntegrationRegistry.isRegistered('jetbrains')) {
  ideIntegrationRegistry.register('jetbrains', jetbrainsIntegrationFactory);
}
```

## Communication Protocols

### Option 1: MCP over HTTP (Recommended)

Follow the same pattern as VS Code integration:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class JetBrainsMCPTransport {
  private mcpClient: Client | null = null;

  async initialize(): Promise<void> {
    this.mcpClient = new Client({
      name: 'gemini-cli-jetbrains-integration',
      version: '1.0.0',
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${jetbrainsPort}/mcp`),
    );

    await this.mcpClient.connect(transport);
  }

  async getActiveFile(): Promise<{
    filePath: string;
    cursor?: { line: number; character: number };
  } | null> {
    if (!this.mcpClient) return null;

    const result = await this.mcpClient.callTool({
      name: 'getActiveFile',
      arguments: {},
    });

    // Parse response and return file info
    return null; // Implement parsing logic
  }
}
```

### Option 2: Custom Protocol

For IDEs that don't support MCP, implement a custom transport:

```typescript
export class JetBrainsLSPTransport {
  async initialize(): Promise<void> {
    // Connect via LSP, WebSocket, or other protocol
  }

  async getActiveFile(): Promise<{ filePath: string } | null> {
    // Use IDE-specific API calls
    return null;
  }
}
```

## Environment Detection

Different IDEs use different methods for environment detection:

### VS Code Pattern

```typescript
// Check environment variable
const isVSCodeEnv = process.env.TERM_PROGRAM === 'vscode';
const port = process.env.GEMINI_CLI_IDE_SERVER_PORT;
```

### JetBrains Pattern

```typescript
// Check for JetBrains-specific environment variables or files
const isJetBrainsEnv =
  process.env.IDEA_INITIAL_DIRECTORY ||
  process.env.PYCHARM_HOSTED ||
  fs.existsSync('.idea/');
```

### Generic Process Detection

```typescript
import { execSync } from 'child_process';

function detectRunningIDE(): string | null {
  try {
    const processes = execSync('ps aux', { encoding: 'utf8' });
    if (processes.includes('idea')) return 'intellij';
    if (processes.includes('pycharm')) return 'pycharm';
    if (processes.includes('code')) return 'vscode';
    return null;
  } catch {
    return null;
  }
}
```

## File Structure

Organize your integration in a dedicated directory:

```
packages/core/src/services/ideIntegrations/
├── jetbrains/
│   ├── index.ts                 # Export factory
│   ├── jetbrainsIntegration.ts  # Main integration class
│   ├── mcpTransport.ts         # MCP transport layer (if applicable)
│   └── lspTransport.ts         # Alternative transport (if needed)
├── types.ts                    # Shared interfaces
├── registry.ts                 # Integration registry
└── ideIntegrationManager.ts    # Manager class
```

## Best Practices

### 1. Error Handling

Always handle connection failures gracefully:

```typescript
async isAvailable(): Promise<boolean> {
  try {
    // Attempt connection or detection
    return await this.checkConnection();
  } catch (error) {
    if (this.config.debug) {
      console.debug(`JetBrains integration not available: ${error}`);
    }
    return false;
  }
}
```

### 2. Non-blocking Initialization

Don't block CLI startup if IDE connection fails:

```typescript
async initialize(): Promise<void> {
  try {
    await this.setupConnection();
  } catch (error) {
    // Log but don't throw - allow CLI to continue
    if (this.config.debug) {
      console.debug('JetBrains initialization failed:', error);
    }
  }
}
```

### 3. Resource Cleanup

Always clean up resources properly:

```typescript
async cleanup(): Promise<void> {
  if (this.connection) {
    try {
      await this.connection.close();
    } catch (error) {
      console.debug('Error during cleanup:', error);
    } finally {
      this.connection = null;
    }
  }
}
```

### 4. Debug Support

Respect the debug configuration:

```typescript
if (this.config.debug) {
  console.debug(`JetBrains integration: ${message}`);
}
```

## Testing Your Integration

### Unit Tests

Create comprehensive unit tests:

```typescript
// jetbrainsIntegration.test.ts
describe('JetBrainsIntegration', () => {
  it('should detect when JetBrains IDE is available', async () => {
    const integration = new JetBrainsIntegration(mockConfig);
    const available = await integration.isAvailable();
    expect(available).toBe(true);
  });
});
```

### Integration Tests

Test the full workflow:

```typescript
it('should get active file context from JetBrains', async () => {
  const integration = new JetBrainsIntegration(mockConfig);
  await integration.initialize();

  const context = await integration.getActiveFileContext();
  expect(context).toEqual({
    filePath: '/path/to/file.java',
    cursor: { line: 10, character: 5 },
  });
});
```

## Registration and Discovery

The IDE Integration Manager automatically discovers and initializes available integrations:

```typescript
// Integration priority order (first available wins)
const integrationIds = ['vscode', 'jetbrains', 'zed'];

for (const id of integrationIds) {
  const integration = await ideIntegrationRegistry.create(id, config);
  if (await integration.isAvailable()) {
    // Use this integration
    break;
  }
}
```

## IDE-Specific Plugin Development

### JetBrains Plugin

You'll need to create a JetBrains plugin that:

1. Exposes an MCP server or other API
2. Provides active file information
3. Handles file change notifications
4. Sets up environment variables for discovery

### Zed Extension

For Zed editor, you might:

1. Use LSP extensions
2. Create custom protocol handlers
3. Integrate with Zed's plugin system

## Contributing

When contributing a new IDE integration:

1. Follow the interface contracts exactly
2. Add comprehensive tests
3. Update this documentation
4. Provide setup instructions for the IDE-side component
5. Include error handling and debug support

## Troubleshooting

Common issues and solutions:

- **Connection timeouts**: Increase timeout values in config
- **Port conflicts**: Use dynamic port allocation
- **Permission issues**: Ensure proper file system access
- **Detection failures**: Add more robust environment detection

See [troubleshooting.md](./troubleshooting.md) for detailed debugging steps.
