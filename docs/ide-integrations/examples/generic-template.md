# Generic IDE Integration Template

This document provides a generic template for creating new IDE integrations with Gemini CLI. Use this as a starting point for implementing support for any IDE or editor.

## Template Structure

### 1. Integration Implementation

```typescript
// packages/core/src/services/ideIntegrations/[ide-name]/[ide-name]Integration.ts
import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from '../types.js';
import { [IdeName]Transport } from './transport.js';

export class [IdeName]Integration implements IDEIntegration {
  readonly id = '[ide-id]';  // e.g., 'myide'
  readonly name = '[IDE Display Name]';  // e.g., 'My IDE'
  readonly description = '[Brief description of the IDE]';

  private transport: [IdeName]Transport;
  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.transport = new [IdeName]Transport(config);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // TODO: Implement IDE detection logic
      // Check for:
      // - Environment variables specific to your IDE
      // - Running processes
      // - Configuration files
      // - Available communication channels

      // Example environment checks:
      const ideEnvVar = this.config.environment.[IDE_ENV_VAR];
      const termProgram = this.config.environment.TERM_PROGRAM;

      // Example process detection:
      // const hasIdeProcess = await this.checkRunningProcesses();

      // Example file-based detection:
      // const hasConfigFile = await this.checkConfigFiles();

      if (!ideEnvVar && termProgram !== '[ide-name]') {
        if (this.config.debug) {
          console.debug('No [IDE Name] environment indicators detected');
        }
        return false;
      }

      // Test if the IDE is reachable via your transport method
      return await this.transport.isAvailable();
    } catch (error) {
      if (this.config.debug) {
        console.debug(`[IDE Name] detection failed:`, error);
      }
      return false;
    }
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    try {
      const fileInfo = await this.transport.getActiveFile();

      if (!fileInfo || !fileInfo.filePath) {
        return null;
      }

      return {
        filePath: fileInfo.filePath,
        cursor: fileInfo.cursor ? {
          line: fileInfo.cursor.line,
          character: fileInfo.cursor.character,
        } : undefined,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn(`Error getting active file from [IDE Name]:`, error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    try {
      await this.transport.sendNotification(message);
    } catch (error) {
      if (this.config.debug) {
        console.warn(`Failed to send notification to [IDE Name]:`, error);
      }
      // Don't throw - notifications are optional
    }
  }

  async initialize(): Promise<void> {
    if (this.config.debug) {
      console.debug('Initializing [IDE Name] integration...');
    }

    try {
      await this.transport.initialize();

      // Set up file change handlers if supported
      this.setupFileChangeHandling();

      if (this.config.debug) {
        console.debug('[IDE Name] integration initialized successfully');
      }
    } catch (error) {
      if (this.config.debug) {
        console.error(`Failed to initialize [IDE Name] integration:`, error);
      }
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.config.debug) {
      console.debug('Cleaning up [IDE Name] integration...');
    }

    try {
      await this.transport.cleanup();
    } catch (error) {
      if (this.config.debug) {
        console.warn(`Error during [IDE Name] integration cleanup:`, error);
      }
    }
  }

  /**
   * Set up a handler for active file change notifications (optional)
   */
  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this.transport.setFileChangeHandler((fileInfo) => {
      if (fileInfo?.filePath) {
        handler({
          filePath: fileInfo.filePath,
          cursor: fileInfo.cursor,
        });
      } else {
        handler(null);
      }
    });
  }

  private setupFileChangeHandling(): void {
    // TODO: Set up real-time file change detection if your IDE supports it
    // This might involve:
    // - WebSocket connections
    // - File system watchers
    // - Polling mechanisms
    // - Event subscriptions
  }

  // Add any IDE-specific helper methods here
  private async checkRunningProcesses(): Promise<boolean> {
    // TODO: Implement process detection logic
    // Example:
    try {
      const { execSync } = require('child_process');
      const processes = execSync('ps aux', { encoding: 'utf8' });
      return processes.includes('[ide-process-name]');
    } catch {
      return false;
    }
  }

  private async checkConfigFiles(): Promise<boolean> {
    // TODO: Implement config file detection logic
    // Example:
    try {
      const fs = require('fs');
      return fs.existsSync('[path-to-ide-config]');
    } catch {
      return false;
    }
  }
}
```

### 2. Transport Layer Template

Choose one of these transport implementations based on your IDE's capabilities:

#### Option A: HTTP/REST API Transport

```typescript
// packages/core/src/services/ideIntegrations/[ide-name]/httpTransport.ts
import { IDEIntegrationConfig } from '../types.js';

const DEFAULT_PORT = 8080;  // Change to your IDE's default port
const DEFAULT_TIMEOUT = 10000;

interface [IdeName]FileInfo {
  filePath: string;
  cursor?: {
    line: number;
    character: number;
  };
  // Add other IDE-specific properties
}

export class [IdeName]Transport {
  private port: number;
  private config: IDEIntegrationConfig;
  private baseUrl: string;
  private fileChangeHandler?: (fileInfo: [IdeName]FileInfo | null) => void;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.port = this.discoverPort();
    this.baseUrl = `http://localhost:${this.port}`;
  }

  private discoverPort(): number {
    const portStr = this.config.environment.[IDE_PORT_ENV_VAR];
    if (portStr) {
      const port = parseInt(portStr, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        return port;
      }
    }
    return DEFAULT_PORT;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      if (this.config.debug) {
        console.debug(`[IDE Name] not available on port ${this.port}:`, error);
      }
      return false;
    }
  }

  async initialize(): Promise<void> {
    // TODO: Implement initialization logic
    if (!(await this.isAvailable())) {
      throw new Error(`[IDE Name] not available on port ${this.port}`);
    }
  }

  async cleanup(): Promise<void> {
    // TODO: Implement cleanup logic
  }

  async getActiveFile(): Promise<[IdeName]FileInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/active-file`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        filePath: data.filePath,
        cursor: data.cursor,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn(`Error getting active file:`, error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    // TODO: Implement notification sending
    await fetch(`${this.baseUrl}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  setFileChangeHandler(
    handler: (fileInfo: [IdeName]FileInfo | null) => void,
  ): void {
    this.fileChangeHandler = handler;
    // TODO: Set up real-time change detection
    // Options: WebSocket, Server-Sent Events, or polling
  }
}
```

#### Option B: MCP Transport

```typescript
// packages/core/src/services/ideIntegrations/[ide-name]/mcpTransport.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { IDEIntegrationConfig } from '../types.js';

export class [IdeName]MCPTransport {
  private mcpClient: Client | null = null;
  private config: IDEIntegrationConfig;
  private port: number;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.port = this.discoverPort();
  }

  private discoverPort(): number {
    // TODO: Implement port discovery for your IDE
    const portStr = this.config.environment.[IDE_PORT_ENV_VAR];
    return portStr ? parseInt(portStr, 10) : 8080;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.port}/mcp`, {
        method: 'GET',
      });
      return response.status === 400; // Expected for GET without session
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    this.mcpClient = new Client({
      name: 'gemini-cli-[ide-name]-integration',
      version: '1.0.0',
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${this.port}/mcp`)
    );

    await this.mcpClient.connect(transport, {
      timeout: this.config.timeout || 10000,
    });
  }

  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      this.mcpClient.close();
      this.mcpClient = null;
    }
  }

  async getActiveFile(): Promise<{filePath: string; cursor?: any} | null> {
    if (!this.mcpClient) return null;

    try {
      const result = await this.mcpClient.callTool({
        name: 'getActiveFile',
        arguments: {},
      });

      // TODO: Parse your IDE's specific response format
      const content = Array.isArray(result.content) ? result.content[0] : undefined;
      if (content?.type === 'text' && content.text) {
        // Parse the response text to extract file info
        // This depends on your IDE's response format
        return this.parseActiveFileResponse(content.text);
      }

      return null;
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error getting active file:', error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    // TODO: Implement MCP-based notification if supported
  }

  setFileChangeHandler(handler: (fileInfo: any) => void): void {
    if (!this.mcpClient) return;

    // TODO: Set up MCP notification handler for file changes
    // This depends on your IDE's notification schema
  }

  private parseActiveFileResponse(text: string): {filePath: string; cursor?: any} | null {
    // TODO: Implement parsing logic for your IDE's response format
    return null;
  }
}
```

#### Option C: LSP Transport

```typescript
// packages/core/src/services/ideIntegrations/[ide-name]/lspTransport.ts
import { spawn, ChildProcess } from 'child_process';
import { IDEIntegrationConfig } from '../types.js';

export class [IdeName]LSPTransport {
  private lspProcess: ChildProcess | null = null;
  private config: IDEIntegrationConfig;
  private messageId = 1;
  private pendingRequests = new Map();

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // TODO: Check if LSP server is available
    const lspPath = this.findLSPServer();
    return !!lspPath;
  }

  async initialize(): Promise<void> {
    const lspPath = this.findLSPServer();
    if (!lspPath) {
      throw new Error('[IDE Name] LSP server not found');
    }

    this.lspProcess = spawn(lspPath, ['--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.setupMessageHandling();
    await this.sendInitializeRequest();
  }

  async cleanup(): Promise<void> {
    if (this.lspProcess) {
      this.lspProcess.kill();
      this.lspProcess = null;
    }
  }

  async getActiveFile(): Promise<any> {
    // TODO: Send LSP request to get active file
    return this.sendRequest('[custom-method]/getActiveFile', {});
  }

  async sendNotification(message: string): Promise<void> {
    // TODO: Send LSP notification
    this.sendNotificationMessage('[custom-method]/showMessage', { message });
  }

  setFileChangeHandler(handler: (fileInfo: any) => void): void {
    // TODO: Set up LSP notification handler
  }

  private findLSPServer(): string | null {
    // TODO: Find your IDE's LSP server executable
    return null;
  }

  private setupMessageHandling(): void {
    // TODO: Implement LSP message handling
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    // TODO: Implement LSP request sending
    return Promise.resolve(null);
  }

  private sendNotificationMessage(method: string, params: any): void {
    // TODO: Implement LSP notification sending
  }

  private async sendInitializeRequest(): Promise<void> {
    // TODO: Send LSP initialize request
  }
}
```

### 3. Integration Factory

```typescript
// packages/core/src/services/ideIntegrations/[ide-name]/index.ts
import { IDEIntegrationFactory } from '../types.js';
import { [IdeName]Integration } from './[ide-name]Integration.js';

export const [ideName]IntegrationFactory: IDEIntegrationFactory = (config) => {
  return new [IdeName]Integration(config);
};

export { [IdeName]Integration } from './[ide-name]Integration.js';
// Export other components as needed
```

### 4. Registration

```typescript
// Add to ideIntegrationManager.ts initialization
import { [ideName]IntegrationFactory } from './[ide-name]/index.js';

// In detectAndConnect method, add your IDE to the priority list
const integrationIds = ['vscode', 'jetbrains', 'zed', '[ide-id]'];

// Register the integration
if (!ideIntegrationRegistry.isRegistered('[ide-id]')) {
  ideIntegrationRegistry.register('[ide-id]', [ideName]IntegrationFactory);
}
```

## IDE-Side Implementation

### Option A: Plugin/Extension for IDE

Create a plugin for your IDE that:

1. **Exposes an API** (HTTP server, MCP server, or LSP server)
2. **Tracks active file** and cursor position
3. **Sends notifications** when files change
4. **Receives notifications** from Gemini CLI
5. **Sets environment variables** for discovery

### Option B: External Bridge Process

Create a separate process that:

1. **Monitors the IDE** through its APIs or file system
2. **Provides the communication interface** for Gemini CLI
3. **Bridges between IDE and CLI** protocols

## Environment Variables

Define IDE-specific environment variables:

```typescript
// Common environment variables to check
const environmentChecks = {
  // Process identification
  TERM_PROGRAM: '[ide-name]',

  // IDE-specific variables
  [IDE_NAME]_HOME: '/path/to/ide',
  [IDE_NAME]_CONFIG: '/path/to/config',
  [IDE_NAME]_PROJECT: '/path/to/project',

  // Communication configuration
  GEMINI_CLI_[IDE_NAME]_PORT: '8080',
  GEMINI_CLI_[IDE_NAME]_SOCKET: '/tmp/socket',
  [IDE_NAME]_LSP_SERVER: '/path/to/lsp',
};
```

## Testing Template

```typescript
// [ide-name]Integration.test.ts
import { [IdeName]Integration } from './[ide-name]Integration.js';
import { IDEIntegrationConfig } from '../types.js';

describe('[IdeName]Integration', () => {
  let integration: [IdeName]Integration;
  let mockConfig: IDEIntegrationConfig;

  beforeEach(() => {
    mockConfig = {
      environment: {
        // Add relevant environment variables
        [IDE_ENV_VAR]: 'test-value',
      },
      timeout: 5000,
      debug: false,
    };
    integration = new [IdeName]Integration(mockConfig);
  });

  describe('isAvailable', () => {
    it('should return true when IDE is detected', async () => {
      // Mock transport availability
      jest.spyOn(integration['transport'], 'isAvailable').mockResolvedValue(true);

      const available = await integration.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when IDE is not detected', async () => {
      const configWithoutIDE = {
        ...mockConfig,
        environment: {},
      };
      const integrationWithoutIDE = new [IdeName]Integration(configWithoutIDE);

      const available = await integrationWithoutIDE.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('getActiveFileContext', () => {
    it('should return active file information', async () => {
      jest.spyOn(integration['transport'], 'getActiveFile').mockResolvedValue({
        filePath: '/test/file.ext',
        cursor: { line: 10, character: 5 },
      });

      const context = await integration.getActiveFileContext();

      expect(context).toEqual({
        filePath: '/test/file.ext',
        cursor: { line: 10, character: 5 },
      });
    });

    it('should return null when no file is active', async () => {
      jest.spyOn(integration['transport'], 'getActiveFile').mockResolvedValue(null);

      const context = await integration.getActiveFileContext();
      expect(context).toBeNull();
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      jest.spyOn(integration['transport'], 'initialize').mockResolvedValue();

      await expect(integration.initialize()).resolves.not.toThrow();
    });

    it('should cleanup resources', async () => {
      jest.spyOn(integration['transport'], 'cleanup').mockResolvedValue();

      await expect(integration.cleanup()).resolves.not.toThrow();
    });
  });

  describe('notifications', () => {
    it('should send notifications to IDE', async () => {
      const mockSendNotification = jest.spyOn(integration['transport'], 'sendNotification').mockResolvedValue();

      await integration.sendNotification('Test message');

      expect(mockSendNotification).toHaveBeenCalledWith('Test message');
    });
  });
});
```

## Implementation Checklist

### Core Requirements

- [ ] Implement `IDEIntegration` interface
- [ ] Create transport layer (HTTP/MCP/LSP)
- [ ] Implement environment detection
- [ ] Add error handling throughout
- [ ] Create integration factory
- [ ] Register with IDE Integration Manager

### Detection Logic

- [ ] Check environment variables
- [ ] Detect running processes (optional)
- [ ] Check configuration files (optional)
- [ ] Test communication channel availability

### Communication

- [ ] Implement active file detection
- [ ] Handle file change notifications (optional)
- [ ] Support notification sending (optional)
- [ ] Add proper timeout handling

### Testing

- [ ] Write unit tests for integration class
- [ ] Test transport layer separately
- [ ] Add integration tests
- [ ] Test error scenarios

### Documentation

- [ ] Update integration examples
- [ ] Add troubleshooting section
- [ ] Document environment variables
- [ ] Provide setup instructions

### IDE-Side Component

- [ ] Create plugin/extension for your IDE
- [ ] Implement API endpoints
- [ ] Set up file change tracking
- [ ] Add environment variable setup
- [ ] Test end-to-end integration

## Common Patterns

### Polling vs Real-time Updates

```typescript
// Polling approach (simpler but less efficient)
private startPolling(): void {
  this.pollingInterval = setInterval(async () => {
    const newFile = await this.transport.getActiveFile();
    if (this.hasFileChanged(newFile)) {
      this.notifyFileChange(newFile);
    }
  }, 1000);
}

// Real-time approach (more efficient)
private setupWebSocket(): void {
  this.ws = new WebSocket('ws://localhost:8080/events');
  this.ws.on('message', (data) => {
    const event = JSON.parse(data);
    if (event.type === 'fileChanged') {
      this.notifyFileChange(event.file);
    }
  });
}
```

### Graceful Degradation

```typescript
async getActiveFileContext(): Promise<ActiveFileContext | null> {
  try {
    // Try primary method
    return await this.transport.getActiveFile();
  } catch (primaryError) {
    try {
      // Fall back to secondary method
      return await this.fallbackMethod();
    } catch (fallbackError) {
      // Log and return null
      if (this.config.debug) {
        console.warn('All file detection methods failed');
      }
      return null;
    }
  }
}
```

### Configuration Validation

```typescript
private validateConfig(): void {
  const required = ['IDE_HOME', 'IDE_PORT'];
  const missing = required.filter(key => !this.config.environment[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

This template provides a comprehensive starting point for implementing any IDE integration. Customize the sections marked with TODO comments based on your specific IDE's capabilities and APIs.
