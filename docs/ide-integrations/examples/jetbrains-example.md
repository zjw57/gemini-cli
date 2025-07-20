# JetBrains IDE Integration Example

This document provides a complete example of how to implement JetBrains IDE integration for Gemini CLI.

## Overview

JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, etc.) support plugin development that can expose APIs for external tools. This example shows how to create a Gemini CLI integration that communicates with a JetBrains plugin.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Gemini CLI                           │
├─────────────────────────────────────────────────────────┤
│              JetBrains Integration                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │            HTTP Transport                       │    │
│  │  - REST API client                              │    │
│  │  - Active file detection                        │    │
│  │  - File change notifications                    │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│                   HTTP/REST API                         │
├─────────────────────────────────────────────────────────┤
│                 JetBrains Plugin                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Gemini Helper Plugin                  │    │
│  │  - HTTP server                                  │    │
│  │  - File state tracking                          │    │
│  │  - Editor event listeners                       │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│            IntelliJ Platform APIs                       │
└─────────────────────────────────────────────────────────┘
```

## Integration Implementation

### 1. JetBrains Integration Class

```typescript
// packages/core/src/services/ideIntegrations/jetbrains/jetbrainsIntegration.ts
import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from '../types.js';
import { JetBrainsHTTPTransport } from './httpTransport.js';

export class JetBrainsIntegration implements IDEIntegration {
  readonly id = 'jetbrains';
  readonly name = 'JetBrains IDEs';
  readonly description =
    'IntelliJ IDEA, PyCharm, WebStorm, and other JetBrains IDEs';

  private transport: JetBrainsHTTPTransport;
  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.transport = new JetBrainsHTTPTransport(config);
  }

  async isAvailable(): Promise<boolean> {
    // Check for JetBrains-specific environment variables
    const ideaInitialDir = this.config.environment.IDEA_INITIAL_DIRECTORY;
    const pycharmHosted = this.config.environment.PYCHARM_HOSTED;
    const webstormPath = this.config.environment.WEBSTORM_VM_OPTIONS;

    // Check if any JetBrains IDE indicators are present
    const hasJetBrainsEnv = !!(ideaInitialDir || pycharmHosted || webstormPath);

    if (!hasJetBrainsEnv) {
      if (this.config.debug) {
        console.debug('No JetBrains environment variables detected');
      }
      return false;
    }

    // Check if the JetBrains plugin is running and reachable
    return await this.transport.isAvailable();
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    try {
      const fileInfo = await this.transport.getActiveFile();

      if (!fileInfo || !fileInfo.filePath) {
        return null;
      }

      return {
        filePath: fileInfo.filePath,
        cursor: fileInfo.cursor
          ? {
              line: fileInfo.cursor.line,
              character: fileInfo.cursor.column,
            }
          : undefined,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error getting active file from JetBrains:', error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    try {
      await this.transport.sendNotification(message);
    } catch (error) {
      if (this.config.debug) {
        console.warn('Failed to send notification to JetBrains:', error);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.config.debug) {
      console.debug('Initializing JetBrains integration...');
    }

    try {
      await this.transport.initialize();

      if (this.config.debug) {
        console.debug('JetBrains integration initialized successfully');
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('Failed to initialize JetBrains integration:', error);
      }
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.config.debug) {
      console.debug('Cleaning up JetBrains integration...');
    }

    try {
      await this.transport.cleanup();
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error during JetBrains integration cleanup:', error);
      }
    }
  }

  /**
   * Set up a handler for active file change notifications
   */
  setActiveFileChangeHandler(
    handler: (context: ActiveFileContext | null) => void,
  ): void {
    this.transport.setFileChangeHandler((fileInfo) => {
      if (fileInfo?.filePath) {
        handler({
          filePath: fileInfo.filePath,
          cursor: fileInfo.cursor
            ? {
                line: fileInfo.cursor.line,
                character: fileInfo.cursor.column,
              }
            : undefined,
        });
      } else {
        handler(null);
      }
    });
  }
}
```

### 2. HTTP Transport Layer

```typescript
// packages/core/src/services/ideIntegrations/jetbrains/httpTransport.ts
import { IDEIntegrationConfig } from '../types.js';

const JETBRAINS_DEFAULT_PORT = 8888;
const DEFAULT_TIMEOUT = 10000;

interface JetBrainsFileInfo {
  filePath: string;
  cursor?: {
    line: number;
    column: number;
  };
  projectPath?: string;
}

export class JetBrainsHTTPTransport {
  private port: number;
  private config: IDEIntegrationConfig;
  private baseUrl: string;
  private fileChangeHandler?: (fileInfo: JetBrainsFileInfo | null) => void;
  private pollingInterval?: NodeJS.Timeout;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.port = this.discoverPort();
    this.baseUrl = `http://localhost:${this.port}`;
  }

  private discoverPort(): number {
    // Check for JetBrains plugin-specific port environment variable
    const portStr = this.config.environment.GEMINI_CLI_JETBRAINS_PORT;
    if (portStr) {
      const port = parseInt(portStr, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        return port;
      }
    }

    // Fall back to default port
    return JETBRAINS_DEFAULT_PORT;
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
        console.debug(
          `JetBrains plugin not available on port ${this.port}:`,
          error,
        );
      }
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error(`JetBrains plugin not available on port ${this.port}`);
    }

    // Start polling for file changes if handler is set
    if (this.fileChangeHandler) {
      this.startFileChangePolling();
    }

    if (this.config.debug) {
      console.debug(`Connected to JetBrains plugin on port ${this.port}`);
    }
  }

  async cleanup(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    if (this.config.debug) {
      console.debug('JetBrains HTTP transport cleaned up');
    }
  }

  async getActiveFile(): Promise<JetBrainsFileInfo | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout || DEFAULT_TIMEOUT,
      );

      const response = await fetch(`${this.baseUrl}/api/editor/active-file`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (this.config.debug) {
          console.debug(
            `JetBrains API returned ${response.status}: ${response.statusText}`,
          );
        }
        return null;
      }

      const data = await response.json();

      return {
        filePath: data.filePath,
        cursor: data.cursor
          ? {
              line: data.cursor.line,
              column: data.cursor.column,
            }
          : undefined,
        projectPath: data.projectPath,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error getting active file from JetBrains:', error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout || DEFAULT_TIMEOUT,
      );

      const response = await fetch(`${this.baseUrl}/api/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Notification failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      if (this.config.debug) {
        console.warn('Failed to send notification to JetBrains:', error);
      }
      throw error;
    }
  }

  setFileChangeHandler(
    handler: (fileInfo: JetBrainsFileInfo | null) => void,
  ): void {
    this.fileChangeHandler = handler;

    // Start polling if we're already initialized
    if (!this.pollingInterval) {
      this.startFileChangePolling();
    }
  }

  private startFileChangePolling(): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    let lastFilePath = '';
    let lastCursorPosition = '';

    this.pollingInterval = setInterval(async () => {
      try {
        const fileInfo = await this.getActiveFile();
        const currentFilePath = fileInfo?.filePath || '';
        const currentCursorPosition = fileInfo?.cursor
          ? `${fileInfo.cursor.line}:${fileInfo.cursor.column}`
          : '';

        // Only notify if file or cursor position changed
        if (
          currentFilePath !== lastFilePath ||
          currentCursorPosition !== lastCursorPosition
        ) {
          lastFilePath = currentFilePath;
          lastCursorPosition = currentCursorPosition;

          if (this.fileChangeHandler) {
            this.fileChangeHandler(fileInfo);
          }
        }
      } catch (error) {
        if (this.config.debug) {
          console.debug('Error during file change polling:', error);
        }
      }
    }, 1000); // Poll every second
  }
}
```

### 3. Integration Factory

```typescript
// packages/core/src/services/ideIntegrations/jetbrains/index.ts
import { IDEIntegrationFactory } from '../types.js';
import { JetBrainsIntegration } from './jetbrainsIntegration.js';

export const jetbrainsIntegrationFactory: IDEIntegrationFactory = (config) => {
  return new JetBrainsIntegration(config);
};

export { JetBrainsIntegration } from './jetbrainsIntegration.js';
export { JetBrainsHTTPTransport } from './httpTransport.js';
```

## JetBrains Plugin Implementation

### Plugin Structure

```
gemini-helper-plugin/
├── src/
│   └── main/
│       ├── java/
│       │   └── com/
│       │       └── example/
│       │           └── gemini/
│       │               ├── GeminiHelperPlugin.java
│       │               ├── server/
│       │               │   ├── GeminiHttpServer.java
│       │               │   └── handlers/
│       │               │       ├── HealthHandler.java
│       │               │       ├── ActiveFileHandler.java
│       │               │       └── NotificationHandler.java
│       │               └── listeners/
│       │                   └── FileChangeListener.java
│       └── resources/
│           └── META-INF/
│               └── plugin.xml
└── build.gradle
```

### Plugin Main Class

```java
// GeminiHelperPlugin.java
package com.example.gemini;

import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import com.example.gemini.server.GeminiHttpServer;

@Service
public class GeminiHelperPlugin implements StartupActivity {
    private GeminiHttpServer httpServer;

    @Override
    public void runActivity(Project project) {
        // Start HTTP server when IDE starts
        startHttpServer();

        // Set environment variable for Gemini CLI to discover
        int port = httpServer.getPort();
        System.setProperty("GEMINI_CLI_JETBRAINS_PORT", String.valueOf(port));
    }

    private void startHttpServer() {
        httpServer = new GeminiHttpServer();
        httpServer.start();
    }

    public void dispose() {
        if (httpServer != null) {
            httpServer.stop();
        }
    }
}
```

### HTTP Server Implementation

```java
// GeminiHttpServer.java
package com.example.gemini.server;

import com.sun.net.httpserver.HttpServer;
import com.example.gemini.server.handlers.*;

import java.io.IOException;
import java.net.InetSocketAddress;

public class GeminiHttpServer {
    private HttpServer server;
    private int port = 8888;

    public void start() {
        try {
            server = HttpServer.create(new InetSocketAddress(port), 0);

            // Register endpoints
            server.createContext("/health", new HealthHandler());
            server.createContext("/api/editor/active-file", new ActiveFileHandler());
            server.createContext("/api/notifications", new NotificationHandler());

            server.setExecutor(null);
            server.start();

            System.out.println("Gemini Helper server started on port " + port);
        } catch (IOException e) {
            System.err.println("Failed to start Gemini Helper server: " + e.getMessage());
        }
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    public int getPort() {
        return port;
    }
}
```

### Active File Handler

```java
// ActiveFileHandler.java
package com.example.gemini.server.handlers;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.openapi.vfs.VirtualFile;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.OutputStream;

public class ActiveFileHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, 0);
            exchange.close();
            return;
        }

        ApplicationManager.getApplication().invokeAndWait(() -> {
            try {
                String response = getActiveFileInfo();
                byte[] responseBytes = response.getBytes("UTF-8");

                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, responseBytes.length);

                OutputStream os = exchange.getResponseBody();
                os.write(responseBytes);
                os.close();
            } catch (IOException e) {
                e.printStackTrace();
            }
        });
    }

    private String getActiveFileInfo() {
        Project[] projects = ProjectManager.getInstance().getOpenProjects();

        for (Project project : projects) {
            FileEditorManager editorManager = FileEditorManager.getInstance(project);
            VirtualFile[] selectedFiles = editorManager.getSelectedFiles();

            if (selectedFiles.length > 0) {
                VirtualFile activeFile = selectedFiles[0];
                Editor editor = editorManager.getSelectedTextEditor();

                StringBuilder json = new StringBuilder();
                json.append("{");
                json.append("\"filePath\":\"").append(activeFile.getPath()).append("\",");
                json.append("\"projectPath\":\"").append(project.getBasePath()).append("\"");

                if (editor != null) {
                    int line = editor.getCaretModel().getLogicalPosition().line;
                    int column = editor.getCaretModel().getLogicalPosition().column;
                    json.append(",\"cursor\":{");
                    json.append("\"line\":").append(line).append(",");
                    json.append("\"column\":").append(column);
                    json.append("}");
                }

                json.append("}");
                return json.toString();
            }
        }

        return "{\"filePath\":null}";
    }
}
```

## Registration and Usage

### Register the Integration

```typescript
// In IDE Integration Manager initialization
import { jetbrainsIntegrationFactory } from './jetbrains/index.js';

if (!ideIntegrationRegistry.isRegistered('jetbrains')) {
  ideIntegrationRegistry.register('jetbrains', jetbrainsIntegrationFactory);
}
```

### Detection Priority

Update the detection order to include JetBrains:

```typescript
// In ideIntegrationManager.ts
const integrationIds = ['vscode', 'jetbrains', 'zed'];
```

## Environment Variables

The JetBrains integration uses these environment variables:

- `GEMINI_CLI_JETBRAINS_PORT` - Port where the JetBrains plugin server is running
- `IDEA_INITIAL_DIRECTORY` - Set by IntelliJ IDEA
- `PYCHARM_HOSTED` - Set by PyCharm
- `WEBSTORM_VM_OPTIONS` - Set by WebStorm

## API Endpoints

The JetBrains plugin exposes these HTTP endpoints:

### GET /health

Health check endpoint.

**Response**: `200 OK` if plugin is running

### GET /api/editor/active-file

Get information about the currently active file.

**Response**:

```json
{
  "filePath": "/path/to/active/file.java",
  "projectPath": "/path/to/project",
  "cursor": {
    "line": 42,
    "column": 15
  }
}
```

### POST /api/notifications

Send a notification to the IDE.

**Request Body**:

```json
{
  "message": "Notification message"
}
```

**Response**: `200 OK` if notification was sent

## Testing the Integration

### Unit Tests

```typescript
// jetbrainsIntegration.test.ts
describe('JetBrainsIntegration', () => {
  it('should detect JetBrains environment', async () => {
    const config = {
      environment: { IDEA_INITIAL_DIRECTORY: '/path/to/project' },
      timeout: 5000,
      debug: false,
    };

    const integration = new JetBrainsIntegration(config);

    // Mock transport availability
    jest.spyOn(integration['transport'], 'isAvailable').mockResolvedValue(true);

    const available = await integration.isAvailable();
    expect(available).toBe(true);
  });
});
```

### Integration Tests

```typescript
it('should get active file from JetBrains plugin', async () => {
  const integration = new JetBrainsIntegration(mockConfig);

  // Mock HTTP response
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        filePath: '/test/file.java',
        cursor: { line: 10, column: 5 },
      }),
  });

  const context = await integration.getActiveFileContext();

  expect(context).toEqual({
    filePath: '/test/file.java',
    cursor: { line: 10, character: 5 },
  });
});
```

## Troubleshooting

### Common Issues

1. **Plugin not detected**: Check that JetBrains environment variables are set
2. **Connection failed**: Verify the plugin is installed and HTTP server is running
3. **Port conflicts**: Ensure port 8888 (or custom port) is available
4. **Active file not found**: Check that a file is actually open in the editor

### Debug Logging

Enable debug mode to see detailed logs:

```bash
gemini --debug --ide-mode
```

This will show connection attempts, API calls, and error details for the JetBrains integration.
