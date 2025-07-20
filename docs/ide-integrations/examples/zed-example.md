# Zed Editor Integration Example

This document provides a complete example of how to implement Zed editor integration for Gemini CLI.

## Overview

Zed is a high-performance code editor with a plugin system based on WebAssembly (WASM) extensions. This example shows how to create a Gemini CLI integration that communicates with a Zed extension.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Gemini CLI                           │
├─────────────────────────────────────────────────────────┤
│                Zed Integration                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │             LSP Transport                       │    │
│  │  - Language Server Protocol client              │    │
│  │  - Active file detection                        │    │
│  │  - File change notifications                    │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│                    LSP Protocol                         │
├─────────────────────────────────────────────────────────┤
│                   Zed Extension                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │         Gemini Helper Extension                 │    │
│  │  - LSP server implementation                    │    │
│  │  - Editor event handling                        │    │
│  │  - File state management                        │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│                   Zed Editor APIs                       │
└─────────────────────────────────────────────────────────┘
```

## Integration Implementation

### 1. Zed Integration Class

```typescript
// packages/core/src/services/ideIntegrations/zed/zedIntegration.ts
import {
  IDEIntegration,
  ActiveFileContext,
  IDEIntegrationConfig,
} from '../types.js';
import { ZedLSPTransport } from './lspTransport.js';

export class ZedIntegration implements IDEIntegration {
  readonly id = 'zed';
  readonly name = 'Zed';
  readonly description =
    'High-performance code editor with collaborative features';

  private transport: ZedLSPTransport;
  private config: IDEIntegrationConfig;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
    this.transport = new ZedLSPTransport(config);
  }

  async isAvailable(): Promise<boolean> {
    // Check for Zed-specific environment variables
    const zedSocket = this.config.environment.ZED_LSP_SOCKET_PATH;
    const zedCollab = this.config.environment.ZED_COLLABORATION_SERVER;

    // Check if running in Zed's integrated terminal
    const termProgram = this.config.environment.TERM_PROGRAM;
    const isZedTerminal =
      termProgram === 'zed' || termProgram === 'zed-preview';

    // Look for Zed process or socket
    const hasZedIndicators = !!(zedSocket || zedCollab || isZedTerminal);

    if (!hasZedIndicators) {
      if (this.config.debug) {
        console.debug('No Zed environment indicators detected');
      }
      return false;
    }

    // Check if the Zed LSP extension is available
    return await this.transport.isAvailable();
  }

  async getActiveFileContext(): Promise<ActiveFileContext | null> {
    try {
      const fileInfo = await this.transport.getActiveFile();

      if (!fileInfo || !fileInfo.uri) {
        return null;
      }

      // Convert file:// URI to file path
      const filePath = this.uriToPath(fileInfo.uri);

      return {
        filePath,
        cursor: fileInfo.selection
          ? {
              line: fileInfo.selection.start.line,
              character: fileInfo.selection.start.character,
            }
          : undefined,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error getting active file from Zed:', error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    try {
      await this.transport.sendNotification(message);
    } catch (error) {
      if (this.config.debug) {
        console.warn('Failed to send notification to Zed:', error);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.config.debug) {
      console.debug('Initializing Zed integration...');
    }

    try {
      await this.transport.initialize();

      if (this.config.debug) {
        console.debug('Zed integration initialized successfully');
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('Failed to initialize Zed integration:', error);
      }
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.config.debug) {
      console.debug('Cleaning up Zed integration...');
    }

    try {
      await this.transport.cleanup();
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error during Zed integration cleanup:', error);
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
      if (fileInfo?.uri) {
        const filePath = this.uriToPath(fileInfo.uri);
        handler({
          filePath,
          cursor: fileInfo.selection
            ? {
                line: fileInfo.selection.start.line,
                character: fileInfo.selection.start.character,
              }
            : undefined,
        });
      } else {
        handler(null);
      }
    });
  }

  private uriToPath(uri: string): string {
    // Convert file:// URI to local file path
    if (uri.startsWith('file://')) {
      return decodeURIComponent(uri.substring(7));
    }
    return uri;
  }
}
```

### 2. LSP Transport Layer

```typescript
// packages/core/src/services/ideIntegrations/zed/lspTransport.ts
import { spawn, ChildProcess } from 'child_process';
import { IDEIntegrationConfig } from '../types.js';

const ZED_LSP_DEFAULT_PORT = 9999;
const DEFAULT_TIMEOUT = 10000;

interface LSPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface LSPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface LSPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

interface ZedFileInfo {
  uri: string;
  selection?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  languageId?: string;
}

export class ZedLSPTransport {
  private config: IDEIntegrationConfig;
  private lspProcess: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: any) => void;
    }
  >();
  private fileChangeHandler?: (fileInfo: ZedFileInfo | null) => void;
  private isInitialized = false;

  constructor(config: IDEIntegrationConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to find Zed LSP server or start it
      const zedLspPath = this.findZedLSPServer();
      if (!zedLspPath) {
        return false;
      }

      // Test if we can start a connection
      const testProcess = spawn(zedLspPath, ['--test'], {
        stdio: 'pipe',
        timeout: 2000,
      });

      return new Promise((resolve) => {
        testProcess.on('spawn', () => {
          testProcess.kill();
          resolve(true);
        });

        testProcess.on('error', () => {
          resolve(false);
        });

        setTimeout(() => {
          testProcess.kill();
          resolve(false);
        }, 2000);
      });
    } catch (error) {
      if (this.config.debug) {
        console.debug('Zed LSP not available:', error);
      }
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const lspPath = this.findZedLSPServer();
    if (!lspPath) {
      throw new Error('Zed LSP server not found');
    }

    // Start the LSP server process
    this.lspProcess = spawn(lspPath, ['--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.lspProcess.stdout || !this.lspProcess.stdin) {
      throw new Error('Failed to create LSP process streams');
    }

    // Set up message handling
    this.setupMessageHandling();

    // Initialize LSP connection
    await this.sendInitializeRequest();

    this.isInitialized = true;

    if (this.config.debug) {
      console.debug('Zed LSP transport initialized');
    }
  }

  async cleanup(): Promise<void> {
    if (this.lspProcess) {
      // Send shutdown request
      try {
        await this.sendRequest('shutdown', {});
        await this.sendNotification('exit', {});
      } catch (error) {
        // Ignore shutdown errors
      }

      this.lspProcess.kill();
      this.lspProcess = null;
    }

    this.pendingRequests.clear();
    this.isInitialized = false;

    if (this.config.debug) {
      console.debug('Zed LSP transport cleaned up');
    }
  }

  async getActiveFile(): Promise<ZedFileInfo | null> {
    if (!this.isInitialized) {
      return null;
    }

    try {
      // Use custom LSP method for getting active file
      const result = await this.sendRequest('gemini/getActiveFile', {});

      return {
        uri: result.uri,
        selection: result.selection,
        languageId: result.languageId,
      };
    } catch (error) {
      if (this.config.debug) {
        console.warn('Error getting active file from Zed LSP:', error);
      }
      return null;
    }
  }

  async sendNotification(message: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('LSP transport not initialized');
    }

    // Send custom notification method
    await this.sendNotification('gemini/showMessage', {
      type: 'info',
      message,
    });
  }

  setFileChangeHandler(handler: (fileInfo: ZedFileInfo | null) => void): void {
    this.fileChangeHandler = handler;
  }

  private findZedLSPServer(): string | null {
    // Check environment variable first
    const customPath = this.config.environment.ZED_LSP_SERVER_PATH;
    if (customPath) {
      return customPath;
    }

    // Try common Zed installation paths
    const commonPaths = [
      '/usr/local/bin/zed-lsp',
      '/opt/zed/bin/zed-lsp',
      '~/.local/bin/zed-lsp',
      // Add platform-specific paths
      process.platform === 'darwin'
        ? '/Applications/Zed.app/Contents/MacOS/zed-lsp'
        : null,
      process.platform === 'win32'
        ? 'C:\\Program Files\\Zed\\zed-lsp.exe'
        : null,
    ].filter(Boolean) as string[];

    for (const path of commonPaths) {
      try {
        // Check if file exists and is executable
        require('fs').accessSync(
          path,
          require('fs').constants.F_OK | require('fs').constants.X_OK,
        );
        return path;
      } catch {
        // Try next path
      }
    }

    return null;
  }

  private setupMessageHandling(): void {
    if (!this.lspProcess?.stdout) {
      return;
    }

    let buffer = '';

    this.lspProcess.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();

      // Process complete messages
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = buffer.substring(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length: (\d+)/);

        if (!contentLengthMatch) break;

        const contentLength = parseInt(contentLengthMatch[1], 10);
        const messageStart = headerEnd + 4;

        if (buffer.length < messageStart + contentLength) break;

        const messageContent = buffer.substring(
          messageStart,
          messageStart + contentLength,
        );
        buffer = buffer.substring(messageStart + contentLength);

        try {
          const message = JSON.parse(messageContent);
          this.handleMessage(message);
        } catch (error) {
          if (this.config.debug) {
            console.debug('Failed to parse LSP message:', error);
          }
        }
      }
    });
  }

  private handleMessage(message: LSPResponse | LSPNotification): void {
    if ('id' in message) {
      // Response to a request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    } else {
      // Notification
      this.handleNotification(message);
    }
  }

  private handleNotification(notification: LSPNotification): void {
    switch (notification.method) {
      case 'gemini/activeFileChanged':
        if (this.fileChangeHandler && notification.params) {
          this.fileChangeHandler({
            uri: notification.params.uri,
            selection: notification.params.selection,
            languageId: notification.params.languageId,
          });
        }
        break;

      case 'window/logMessage':
        if (this.config.debug && notification.params) {
          console.debug(`Zed LSP: ${notification.params.message}`);
        }
        break;
    }
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;

      this.pendingRequests.set(id, { resolve, reject });

      const request: LSPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.sendMessage(request);

      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, this.config.timeout || DEFAULT_TIMEOUT);
    });
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    const notification: LSPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.sendMessage(notification);
  }

  private sendMessage(message: LSPRequest | LSPNotification): void {
    if (!this.lspProcess?.stdin) {
      throw new Error('LSP process not available');
    }

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

    this.lspProcess.stdin.write(header + content);
  }

  private async sendInitializeRequest(): Promise<void> {
    const initializeParams = {
      processId: process.pid,
      clientInfo: {
        name: 'gemini-cli',
        version: '1.0.0',
      },
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: true,
          },
        },
      },
    };

    await this.sendRequest('initialize', initializeParams);
    await this.sendNotification('initialized', {});
  }
}
```

### 3. Integration Factory

```typescript
// packages/core/src/services/ideIntegrations/zed/index.ts
import { IDEIntegrationFactory } from '../types.js';
import { ZedIntegration } from './zedIntegration.js';

export const zedIntegrationFactory: IDEIntegrationFactory = (config) => {
  return new ZedIntegration(config);
};

export { ZedIntegration } from './zedIntegration.js';
export { ZedLSPTransport } from './lspTransport.js';
```

## Zed Extension Implementation

### Extension Structure

```
gemini-helper-extension/
├── extension.toml
├── src/
│   ├── lib.rs
│   ├── lsp_server.rs
│   └── editor_state.rs
└── Cargo.toml
```

### Extension Manifest

```toml
# extension.toml
id = "gemini-helper"
name = "Gemini Helper"
description = "Helper extension for Gemini CLI integration"
version = "0.1.0"
schema_version = 1
authors = ["Your Name <your.email@example.com>"]

[extension]
version = "0.15.0"

[extension.wasm]
path = "target/wasm32-wasi/release/gemini_helper.wasm"
```

### Main Extension Code

```rust
// src/lib.rs
use zed_extension_api::{self as zed, Result};

struct GeminiHelperExtension {
    lsp_server: Option<lsp_server::GeminiLSPServer>,
}

impl zed::Extension for GeminiHelperExtension {
    fn new() -> Self {
        Self { lsp_server: None }
    }

    fn activate(&mut self, _: &mut zed::ExtensionContext) -> Result<()> {
        // Start LSP server for Gemini CLI communication
        let server = lsp_server::GeminiLSPServer::new();
        server.start()?;
        self.lsp_server = Some(server);

        // Set environment variable for CLI discovery
        std::env::set_var("ZED_LSP_SOCKET_PATH", server.socket_path());

        Ok(())
    }

    fn deactivate(&mut self) {
        if let Some(server) = &mut self.lsp_server {
            server.stop();
        }
    }
}

zed::register_extension!(GeminiHelperExtension);
```

### LSP Server Implementation

```rust
// src/lsp_server.rs
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tower_lsp::{LspService, Server};
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use zed_extension_api as zed;

pub struct GeminiLSPServer {
    active_file: Arc<Mutex<Option<ActiveFileInfo>>>,
    client: Option<tower_lsp::Client>,
}

#[derive(Clone)]
struct ActiveFileInfo {
    uri: Url,
    selection: Option<Range>,
    language_id: String,
}

impl GeminiLSPServer {
    pub fn new() -> Self {
        Self {
            active_file: Arc::new(Mutex::new(None)),
            client: None,
        }
    }

    pub fn start(&mut self) -> zed::Result<()> {
        // Start LSP server in background
        let (service, socket) = LspService::new(|client| {
            GeminiLanguageServer {
                client,
                active_file: self.active_file.clone(),
            }
        });

        tokio::spawn(async move {
            let stdin = tokio::io::stdin();
            let stdout = tokio::io::stdout();
            Server::new(stdin, stdout, socket).serve(service).await;
        });

        // Set up editor event listeners
        self.setup_editor_listeners()?;

        Ok(())
    }

    pub fn socket_path(&self) -> String {
        "/tmp/zed-gemini-lsp.sock".to_string()
    }

    pub fn stop(&mut self) {
        // Cleanup resources
    }

    fn setup_editor_listeners(&self) -> zed::Result<()> {
        let active_file = self.active_file.clone();

        // Listen for active file changes
        zed::editor::on_active_file_changed(move |file_info| {
            if let Some(info) = file_info {
                let mut active = active_file.lock().unwrap();
                *active = Some(ActiveFileInfo {
                    uri: Url::from_file_path(&info.path).unwrap(),
                    selection: info.selection.map(|sel| Range {
                        start: Position {
                            line: sel.start.line as u32,
                            character: sel.start.character as u32,
                        },
                        end: Position {
                            line: sel.end.line as u32,
                            character: sel.end.character as u32,
                        },
                    }),
                    language_id: info.language_id.unwrap_or_default(),
                });

                // Notify CLI about file change
                if let Some(client) = &self.client {
                    let params = serde_json::json!({
                        "uri": active.as_ref().unwrap().uri,
                        "selection": active.as_ref().unwrap().selection,
                        "languageId": active.as_ref().unwrap().language_id,
                    });

                    client.send_notification::<notification::LogMessage>(LogMessageParams {
                        typ: MessageType::INFO,
                        message: "gemini/activeFileChanged".to_string(),
                    });
                }
            }
        });

        Ok(())
    }
}

struct GeminiLanguageServer {
    client: tower_lsp::Client,
    active_file: Arc<Mutex<Option<ActiveFileInfo>>>,
}

#[tower_lsp::async_trait]
impl tower_lsp::LanguageServer for GeminiLanguageServer {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                workspace: Some(WorkspaceServerCapabilities {
                    workspace_folders: Some(WorkspaceFoldersServerCapabilities {
                        supported: Some(true),
                        change_notifications: Some(OneOf::Left(true)),
                    }),
                    file_operations: None,
                }),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, "Gemini LSP server initialized")
            .await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }
}

// Custom LSP methods for Gemini integration
impl GeminiLanguageServer {
    async fn get_active_file(&self) -> Result<serde_json::Value> {
        let active = self.active_file.lock().unwrap();

        if let Some(file_info) = &*active {
            Ok(serde_json::json!({
                "uri": file_info.uri,
                "selection": file_info.selection,
                "languageId": file_info.language_id,
            }))
        } else {
            Ok(serde_json::json!({ "uri": null }))
        }
    }

    async fn show_message(&self, params: serde_json::Value) -> Result<()> {
        if let Some(message) = params.get("message").and_then(|m| m.as_str()) {
            // Show notification in Zed
            zed::notifications::show_message(
                zed::notifications::MessageType::Info,
                message,
            );
        }
        Ok(())
    }
}
```

## Registration and Usage

### Register the Integration

```typescript
// In IDE Integration Manager initialization
import { zedIntegrationFactory } from './zed/index.js';

if (!ideIntegrationRegistry.isRegistered('zed')) {
  ideIntegrationRegistry.register('zed', zedIntegrationFactory);
}
```

### Detection Priority

Update the detection order to include Zed:

```typescript
// In ideIntegrationManager.ts
const integrationIds = ['vscode', 'jetbrains', 'zed'];
```

## Environment Variables

The Zed integration uses these environment variables:

- `ZED_LSP_SERVER_PATH` - Custom path to Zed LSP server executable
- `ZED_LSP_SOCKET_PATH` - Socket path for LSP communication
- `ZED_COLLABORATION_SERVER` - Set when using Zed collaboration features
- `TERM_PROGRAM` - Set to 'zed' when running in Zed's terminal

## LSP Methods

The Zed extension exposes these custom LSP methods:

### gemini/getActiveFile

Get information about the currently active file.

**Response**:

```json
{
  "uri": "file:///path/to/active/file.rs",
  "selection": {
    "start": { "line": 42, "character": 15 },
    "end": { "line": 42, "character": 20 }
  },
  "languageId": "rust"
}
```

### gemini/showMessage

Send a notification to Zed.

**Parameters**:

```json
{
  "type": "info",
  "message": "Notification message"
}
```

### gemini/activeFileChanged (Notification)

Sent when the active file changes.

**Parameters**:

```json
{
  "uri": "file:///path/to/new/file.rs",
  "selection": {
    "start": { "line": 10, "character": 5 },
    "end": { "line": 10, "character": 5 }
  },
  "languageId": "rust"
}
```

## Testing the Integration

### Unit Tests

```typescript
// zedIntegration.test.ts
describe('ZedIntegration', () => {
  it('should detect Zed environment', async () => {
    const config = {
      environment: { TERM_PROGRAM: 'zed' },
      timeout: 5000,
      debug: false,
    };

    const integration = new ZedIntegration(config);

    // Mock transport availability
    jest.spyOn(integration['transport'], 'isAvailable').mockResolvedValue(true);

    const available = await integration.isAvailable();
    expect(available).toBe(true);
  });
});
```

### Integration Tests

```typescript
it('should get active file from Zed LSP', async () => {
  const integration = new ZedIntegration(mockConfig);

  // Mock LSP response
  jest.spyOn(integration['transport'], 'getActiveFile').mockResolvedValue({
    uri: 'file:///test/file.rs',
    selection: {
      start: { line: 10, character: 5 },
      end: { line: 10, character: 5 },
    },
    languageId: 'rust',
  });

  const context = await integration.getActiveFileContext();

  expect(context).toEqual({
    filePath: '/test/file.rs',
    cursor: { line: 10, character: 5 },
  });
});
```

## Building the Extension

### Rust Setup

```bash
# Install Rust and WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasi

# Build the extension
cargo build --target wasm32-wasi --release
```

### Extension Installation

```bash
# Install the extension in Zed
cp target/wasm32-wasi/release/gemini_helper.wasm ~/.config/zed/extensions/gemini-helper/
```

## Troubleshooting

### Common Issues

1. **Extension not detected**: Check that TERM_PROGRAM is set to 'zed'
2. **LSP connection failed**: Verify the extension is installed and active
3. **Process spawning issues**: Check LSP server path and permissions
4. **Active file not detected**: Ensure a file is open and the extension is running

### Debug Logging

Enable debug mode to see detailed logs:

```bash
gemini --debug --ide-mode
```

This will show LSP communication, process spawning, and error details for the Zed integration.
