# IDE Integration API Reference

This document provides detailed API reference for the IDE integration system interfaces and classes.

## Core Interfaces

### IDEIntegration

The main interface that all IDE integrations must implement.

```typescript
interface IDEIntegration {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  isAvailable(): Promise<boolean>;
  getActiveFileContext(): Promise<ActiveFileContext | null>;
  sendNotification(message: string): Promise<void>;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}
```

#### Properties

##### `id: string`

Unique identifier for the integration. Used for registration and discovery.

**Examples**: `'vscode'`, `'jetbrains'`, `'zed'`

##### `name: string`

Human-readable name of the IDE or editor.

**Examples**: `'Visual Studio Code'`, `'JetBrains IDEs'`, `'Zed'`

##### `description: string`

Brief description of what the integration supports.

**Examples**: `'Microsoft Visual Studio Code integration via MCP over HTTP'`

#### Methods

##### `isAvailable(): Promise<boolean>`

Checks if the IDE is currently available and can be connected to.

**Returns**: Promise resolving to `true` if IDE is detected and reachable.

**Implementation Notes**:

- Should not throw exceptions; return `false` on any error
- Should be fast (< 2 seconds) to avoid blocking startup
- May check environment variables, process lists, or attempt connections

**Example**:

```typescript
async isAvailable(): Promise<boolean> {
  try {
    const isVSCodeEnv = this.config.environment.TERM_PROGRAM === 'vscode';
    const hasPort = !!this.config.environment.GEMINI_CLI_IDE_SERVER_PORT;
    return isVSCodeEnv && hasPort;
  } catch {
    return false;
  }
}
```

##### `getActiveFileContext(): Promise<ActiveFileContext | null>`

Retrieves information about the currently active file in the IDE.

**Returns**: Promise resolving to `ActiveFileContext` object or `null` if no file is active.

**Error Handling**: Should return `null` on errors, not throw exceptions.

**Example**:

```typescript
async getActiveFileContext(): Promise<ActiveFileContext | null> {
  try {
    const result = await this.transport.getActiveFile();
    return result ? {
      filePath: result.filePath,
      cursor: result.cursor
    } : null;
  } catch (error) {
    if (this.config.debug) {
      console.warn('Error getting active file:', error);
    }
    return null;
  }
}
```

##### `sendNotification(message: string): Promise<void>`

Sends a notification message to the IDE (optional feature).

**Parameters**:

- `message: string` - The notification message to display

**Returns**: Promise that resolves when notification is sent.

**Implementation Notes**:

- This is an optional feature; implementations may be no-ops
- Should not throw exceptions; log errors instead

##### `initialize(): Promise<void>`

Sets up the integration and establishes connection to the IDE.

**Returns**: Promise that resolves when initialization is complete.

**Error Handling**: May throw exceptions if initialization fails critically.

**Example**:

```typescript
async initialize(): Promise<void> {
  if (this.config.debug) {
    console.debug('Initializing VS Code integration...');
  }

  await this.transport.initialize();

  // Set up file change notifications
  this.setupNotificationHandlers();
}
```

##### `cleanup(): Promise<void>`

Cleans up resources and closes connections.

**Returns**: Promise that resolves when cleanup is complete.

**Implementation Notes**:

- Should never throw exceptions
- Must be safe to call multiple times
- Should clean up all resources (connections, timers, listeners)

### ActiveFileContext

Represents information about the currently active file in an IDE.

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

Absolute path to the currently active file.

**Format**: Platform-specific absolute path (e.g., `/Users/name/project/file.js` on Unix, `C:\Users\name\project\file.js` on Windows)

##### `cursor?: { line: number; character: number }`

Current cursor position in the file (optional).

**Properties**:

- `line: number` - Zero-based line number
- `character: number` - Zero-based character offset within the line

### IDEIntegrationConfig

Configuration object passed to IDE integrations during creation.

```typescript
interface IDEIntegrationConfig {
  environment: Record<string, string | undefined>;
  timeout: number;
  debug: boolean;
}
```

#### Properties

##### `environment: Record<string, string | undefined>`

Environment variables available to the integration.

**Usage**: Used for detecting IDE-specific environment variables and connection parameters.

**Example**:

```typescript
const port = this.config.environment.GEMINI_CLI_IDE_SERVER_PORT;
const isVSCode = this.config.environment.TERM_PROGRAM === 'vscode';
```

##### `timeout: number`

Timeout in milliseconds for connection and operation attempts.

**Default**: `10000` (10 seconds)

##### `debug: boolean`

Whether debug logging should be enabled.

**Usage**: Log detailed information when `true`, remain silent when `false`.

### IDEIntegrationFactory

Factory function type for creating IDE integration instances.

```typescript
type IDEIntegrationFactory = (config: IDEIntegrationConfig) => IDEIntegration;
```

**Parameters**:

- `config: IDEIntegrationConfig` - Configuration for the integration

**Returns**: New `IDEIntegration` instance

**Example**:

```typescript
export const vscodeIntegrationFactory: IDEIntegrationFactory = (config) => {
  return new VSCodeIntegration(config);
};
```

## Core Classes

### IDEIntegrationRegistry

Central registry for managing IDE integration factories.

```typescript
class IDEIntegrationRegistry {
  register(id: string, factory: IDEIntegrationFactory): void;
  create(id: string, config: IDEIntegrationConfig): Promise<IDEIntegration>;
  isRegistered(id: string): boolean;
  getRegisteredIds(): string[];
  unregister(id: string): void;
  cleanup(): Promise<void>;
}
```

#### Methods

##### `register(id: string, factory: IDEIntegrationFactory): void`

Registers a new IDE integration factory.

**Parameters**:

- `id: string` - Unique identifier for the integration
- `factory: IDEIntegrationFactory` - Factory function to create integration instances

**Throws**: Error if an integration with the same ID is already registered.

**Example**:

```typescript
ideIntegrationRegistry.register('jetbrains', jetbrainsIntegrationFactory);
```

##### `create(id: string, config: IDEIntegrationConfig): Promise<IDEIntegration>`

Creates a new integration instance using the registered factory.

**Parameters**:

- `id: string` - ID of the integration to create
- `config: IDEIntegrationConfig` - Configuration for the integration

**Returns**: Promise resolving to new integration instance

**Throws**: Error if no factory is registered for the given ID.

##### `isRegistered(id: string): boolean`

Checks if an integration is registered.

**Parameters**:

- `id: string` - Integration ID to check

**Returns**: `true` if registered, `false` otherwise

##### `getRegisteredIds(): string[]`

Gets list of all registered integration IDs.

**Returns**: Array of integration IDs

##### `unregister(id: string): void`

Removes an integration from the registry.

**Parameters**:

- `id: string` - Integration ID to remove

**Note**: Does not clean up existing instances; only prevents new instances from being created.

##### `cleanup(): Promise<void>`

Cleans up the registry (currently a no-op but reserved for future use).

### IDEIntegrationManager

Singleton manager that coordinates all IDE integrations.

```typescript
class IDEIntegrationManager {
  static getInstance(): IDEIntegrationManager;

  initialize(config: IDEIntegrationConfig): Promise<void>;
  getActiveIntegration(): IDEIntegration | null;
  isActive(): boolean;
  getStatus(): Promise<IDEIntegrationStatus>;
  cleanup(): Promise<void>;
  connectToIDE(ideId: string, config: IDEIntegrationConfig): Promise<boolean>;
}
```

#### Methods

##### `static getInstance(): IDEIntegrationManager`

Gets the singleton instance of the manager.

**Returns**: The singleton `IDEIntegrationManager` instance

##### `initialize(config: IDEIntegrationConfig): Promise<void>`

Initializes the manager and detects available IDE integrations.

**Parameters**:

- `config: IDEIntegrationConfig` - Configuration for integration detection

**Process**:

1. Registers built-in integrations
2. Attempts to connect to available IDEs in priority order
3. Sets up the first available integration as active

##### `getActiveIntegration(): IDEIntegration | null`

Gets the currently active IDE integration.

**Returns**: Active integration instance or `null` if none is active

##### `isActive(): boolean`

Checks if any IDE integration is currently active.

**Returns**: `true` if an integration is active, `false` otherwise

##### `getStatus(): Promise<IDEIntegrationStatus>`

Gets detailed status information about the current integration.

**Returns**: Promise resolving to status object

```typescript
interface IDEIntegrationStatus {
  active: boolean;
  integration?: {
    id: string;
    name: string;
    description: string;
    available: boolean;
  };
}
```

##### `cleanup(): Promise<void>`

Cleans up the manager and all active integrations.

**Process**:

1. Cleans up active integration
2. Cleans up registry
3. Clears IDE context
4. Resets initialization state

##### `connectToIDE(ideId: string, config: IDEIntegrationConfig): Promise<boolean>`

Manually connects to a specific IDE integration.

**Parameters**:

- `ideId: string` - ID of the integration to connect to
- `config: IDEIntegrationConfig` - Configuration for the connection

**Returns**: Promise resolving to `true` if connection succeeded

## Usage Examples

### Creating a Custom Integration

```typescript
import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from './types.js';

export class CustomIntegration implements IDEIntegration {
  readonly id = 'custom';
  readonly name = 'Custom Editor';
  readonly description = 'Custom editor integration';

  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // Implement detection logic
    return false;
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    // Implement file context retrieval
    return null;
  }

  async sendNotification(message: string): Promise<void> {
    // Implement notification sending
  }

  async initialize(): Promise<void> {
    // Implement initialization
  }

  async cleanup(): Promise<void> {
    // Implement cleanup
  }
}
```

### Registering and Using an Integration

```typescript
import { ideIntegrationRegistry, ideIntegrationManager } from './index.js';
import { customIntegrationFactory } from './custom/index.js';

// Register the integration
ideIntegrationRegistry.register('custom', customIntegrationFactory);

// Initialize the manager (will auto-detect available integrations)
await ideIntegrationManager.initialize({
  environment: process.env,
  timeout: 10000,
  debug: true,
});

// Check if any integration is active
if (ideIntegrationManager.isActive()) {
  const integration = ideIntegrationManager.getActiveIntegration();
  const context = await integration?.getActiveFileContext();
  console.log('Active file:', context?.filePath);
}
```

### Error Handling Patterns

```typescript
// In integration implementation
async getActiveFileContext(): Promise<ActiveFileContext | null> {
  try {
    const result = await this.performFileDetection();
    return this.parseFileResult(result);
  } catch (error) {
    // Log error but don't throw
    if (this.config.debug) {
      console.warn(`${this.name} file detection failed:`, error);
    }
    return null;
  }
}

// In manager usage
try {
  await ideIntegrationManager.initialize(config);
} catch (error) {
  // Non-blocking - log but continue
  console.debug('IDE integration initialization failed:', error);
}
```

## Extension Points

### Custom Transport Layers

Integrations can implement custom transport mechanisms:

```typescript
interface Transport {
  initialize(): Promise<void>;
  getActiveFile(): Promise<FileInfo | null>;
  sendNotification(message: string): Promise<void>;
  cleanup(): Promise<void>;
}

class CustomTransport implements Transport {
  // Implement custom protocol (WebSocket, LSP, etc.)
}
```

### Event Handling

Integrations can set up custom event handlers:

```typescript
export class MyIntegration implements IDEIntegration {
  private eventHandlers = new Map<string, Function>();

  setFileChangeHandler(handler: (context: ActiveFileContext) => void): void {
    this.eventHandlers.set('fileChange', handler);
  }

  private notifyFileChange(context: ActiveFileContext): void {
    const handler = this.eventHandlers.get('fileChange');
    if (handler) {
      handler(context);
    }
  }
}
```
