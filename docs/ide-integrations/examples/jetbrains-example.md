# JetBrains IDE Integration Example

This document provides a complete example of how to create a JetBrains IDE plugin that implements an MCP server for Gemini CLI integration.

## Overview

JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, etc.) can integrate with Gemini CLI by running an MCP (Model Context Protocol) server in a plugin. This follows the protocol-first architecture where the IDE plugin handles IDE-specific logic and communicates with Gemini CLI via the standard MCP protocol.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Gemini CLI                           │
│              (IDE-agnostic)                             │
├─────────────────────────────────────────────────────────┤
│                MCP Protocol                             │
│                HTTP Transport                           │
├─────────────────────────────────────────────────────────┤
│               JetBrains Plugin                          │
│                (MCP Server)                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │            MCP Server                           │    │
│  │  - HTTP server for MCP protocol                 │    │
│  │  - getActiveFile tool implementation            │    │
│  │  - File change notifications                    │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│            IntelliJ Platform APIs                       │
│            (FileEditorManager, etc.)                    │
└─────────────────────────────────────────────────────────┘
```

## Plugin Implementation

### 1. Plugin Structure

Create a JetBrains plugin with the following structure:

```
gemini-cli-companion/
├── src/main/kotlin/
│   ├── com/google/geminicli/
│   │   ├── GeminiCliPlugin.kt          # Main plugin class
│   │   ├── MCPServer.kt                # MCP server implementation
│   │   ├── ActiveFileService.kt        # File tracking service
│   │   └── MCPHandler.kt               # MCP request handler
├── src/main/resources/
│   └── META-INF/
│       └── plugin.xml                  # Plugin configuration
└── build.gradle.kts                    # Build configuration
```

### 2. Plugin Configuration

**`src/main/resources/META-INF/plugin.xml`**:

```xml
<idea-plugin>
  <id>com.google.gemini-cli-companion</id>
  <name>Gemini CLI Companion</name>
  <vendor email="support@google.com" url="https://github.com/google/gemini-cli">Google</vendor>

  <description><![CDATA[
    JetBrains IDE companion for Gemini CLI. Provides context about active files
    and editor state via Model Context Protocol (MCP).
  ]]></description>

  <depends>com.intellij.modules.platform</depends>

  <applicationListeners>
    <listener class="com.google.geminicli.GeminiCliPlugin"
              topic="com.intellij.ide.AppLifecycleListener"/>
  </applicationListeners>

  <extensions defaultExtensionNs="com.intellij">
    <applicationService serviceImplementation="com.google.geminicli.ActiveFileService"/>
    <applicationService serviceImplementation="com.google.geminicli.MCPServer"/>
  </extensions>
</idea-plugin>
```

### 3. Main Plugin Class

**`src/main/kotlin/com/google/geminicli/GeminiCliPlugin.kt`**:

```kotlin
package com.google.geminicli

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.thisLogger

class GeminiCliPlugin : AppLifecycleListener {

    override fun appStarted() {
        thisLogger().info("Starting Gemini CLI companion plugin...")

        try {
            val mcpServer = ApplicationManager.getApplication().getService(MCPServer::class.java)
            mcpServer.start()

            // Set environment variable for Gemini CLI discovery
            val port = mcpServer.getPort()
            System.setProperty("GEMINI_CLI_IDE_SERVER_PORT", port.toString())

            thisLogger().info("Gemini CLI MCP server started on port $port")
        } catch (e: Exception) {
            thisLogger().error("Failed to start Gemini CLI MCP server", e)
        }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        thisLogger().info("Stopping Gemini CLI companion plugin...")

        try {
            val mcpServer = ApplicationManager.getApplication().getService(MCPServer::class.java)
            mcpServer.stop()
        } catch (e: Exception) {
            thisLogger().error("Error stopping Gemini CLI MCP server", e)
        }
    }
}
```

### 4. Active File Service

**`src/main/kotlin/com/google/geminicli/ActiveFileService.kt`**:

```kotlin
package com.google.geminicli

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.VirtualFile

@Service(Service.Level.APP)
class ActiveFileService {

    private var currentFile: VirtualFile? = null
    private var currentLine: Int = 0
    private var currentColumn: Int = 0

    init {
        // Listen for file editor changes
        ApplicationManager.getApplication().messageBus.connect()
            .subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, object : FileEditorManagerListener {
                override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
                    updateActiveFile(file)
                }

                override fun selectionChanged(event: FileEditorManagerListener.FileEditorManagerSelectionChangeEvent) {
                    event.newFile?.let { updateActiveFile(it) }
                }
            })

        // Listen for cursor position changes
        EditorFactory.getInstance().addEditorFactoryListener(object : EditorFactoryListener {
            override fun editorCreated(event: EditorFactoryEvent) {
                val editor = event.editor
                editor.caretModel.addCaretListener { caretEvent ->
                    currentLine = caretEvent.caret?.logicalPosition?.line ?: 0
                    currentColumn = caretEvent.caret?.logicalPosition?.column ?: 0
                }
            }
        }, ApplicationManager.getApplication())
    }

    private fun updateActiveFile(file: VirtualFile) {
        currentFile = file
        // Could send MCP notification here if real-time updates are needed
    }

    fun getActiveFileInfo(): String {
        val file = currentFile
        return if (file != null) {
            "Active file: ${file.path} (line: $currentLine, char: $currentColumn)"
        } else {
            "No file is currently active"
        }
    }

    fun getCurrentFile(): VirtualFile? = currentFile
    fun getCurrentLine(): Int = currentLine
    fun getCurrentColumn(): Int = currentColumn
}
```

### 5. MCP Server Implementation

**`src/main/kotlin/com/google/geminicli/MCPServer.kt`**:

```kotlin
package com.google.geminicli

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.thisLogger
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import java.net.ServerSocket

@Service(Service.Level.APP)
class MCPServer {

    private var server: NettyApplicationEngine? = null
    private var port: Int = 0

    fun start() {
        port = findAvailablePort()

        server = embeddedServer(Netty, port = port) {
            install(ContentNegotiation) {
                json()
            }

            install(CORS) {
                allowMethod(HttpMethod.Get)
                allowMethod(HttpMethod.Post)
                allowMethod(HttpMethod.Options)
                allowHeader(HttpHeaders.ContentType)
                anyHost()
            }

            routing {
                // MCP endpoint
                route("/mcp") {
                    get {
                        // Return 400 for GET requests (MCP discovery pattern)
                        call.respond(HttpStatusCode.BadRequest)
                    }

                    post {
                        try {
                            val requestBody = call.receiveText()
                            val response = handleMCPRequest(requestBody)
                            call.respond(response)
                        } catch (e: Exception) {
                            thisLogger().error("Error handling MCP request", e)
                            call.respond(HttpStatusCode.InternalServerError,
                                mapOf("error" to e.message))
                        }
                    }
                }
            }
        }

        server?.start(wait = false)
    }

    fun stop() {
        server?.stop(1000, 2000)
        server = null
    }

    fun getPort(): Int = port

    private fun findAvailablePort(): Int {
        // Try preferred port first
        val preferredPort = System.getenv("GEMINI_CLI_IDE_SERVER_PORT")?.toIntOrNull() ?: 58767

        val portsToTry = listOf(preferredPort, 58767, 3000, 8080)

        for (testPort in portsToTry) {
            try {
                ServerSocket(testPort).use {
                    return testPort
                }
            } catch (e: Exception) {
                // Port is in use, try next
            }
        }

        // Find any available port
        return ServerSocket(0).use { it.localPort }
    }

    private fun handleMCPRequest(requestBody: String): Map<String, Any> {
        val request = Json.parseToJsonElement(requestBody).jsonObject

        val method = request["method"]?.jsonPrimitive?.content
        val id = request["id"]?.jsonPrimitive?.int ?: 1
        val params = request["params"]?.jsonObject

        return when (method) {
            "tools/call" -> {
                val toolName = params?.get("name")?.jsonPrimitive?.content
                when (toolName) {
                    "getActiveFile" -> {
                        val activeFileService = ApplicationManager.getApplication()
                            .getService(ActiveFileService::class.java)
                        val fileInfo = activeFileService.getActiveFileInfo()

                        mapOf(
                            "jsonrpc" to "2.0",
                            "id" to id,
                            "result" to mapOf(
                                "content" to listOf(
                                    mapOf(
                                        "type" to "text",
                                        "text" to fileInfo
                                    )
                                )
                            )
                        )
                    }
                    else -> createErrorResponse(id, "Unknown tool: $toolName")
                }
            }
            else -> createErrorResponse(id, "Unknown method: $method")
        }
    }

    private fun createErrorResponse(id: Int, message: String): Map<String, Any> {
        return mapOf(
            "jsonrpc" to "2.0",
            "id" to id,
            "error" to mapOf(
                "code" to -32601,
                "message" to message
            )
        )
    }
}
```

### 6. Build Configuration

**`build.gradle.kts`**:

```kotlin
plugins {
    id("org.jetbrains.kotlin.jvm") version "1.9.10"
    id("org.jetbrains.intellij") version "1.15.0"
    kotlin("plugin.serialization") version "1.9.10"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-core:2.3.4")
    implementation("io.ktor:ktor-server-netty:2.3.4")
    implementation("io.ktor:ktor-server-content-negotiation:2.3.4")
    implementation("io.ktor:ktor-server-cors:2.3.4")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.4")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
}

intellij {
    version.set("2023.2")
    type.set("IC") // IntelliJ IDEA Community Edition
    plugins.set(listOf(/* Plugin Dependencies */))
}

tasks {
    patchPluginXml {
        sinceBuild.set("232")
        untilBuild.set("241.*")
    }

    buildPlugin {
        archiveFileName.set("gemini-cli-companion.zip")
    }
}
```

## Testing the Integration

### 1. Install the Plugin

1. Build the plugin: `./gradlew buildPlugin`
2. Install in IntelliJ: **Settings** → **Plugins** → **Install Plugin from Disk**
3. Restart IntelliJ IDEA

### 2. Test MCP Server

```bash
# Check if the MCP server is running
curl -X GET http://localhost:58767/mcp
# Should return HTTP 400

# Test the getActiveFile tool
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

### 3. Test with Gemini CLI

```bash
# Start Gemini CLI in IDE mode
gemini-cli --ide-mode

# Check integration status
/ide status
# Should show: 🟢 MCP Integration - Connected

# The active file context should now be automatically available in prompts
```

## Advanced Features

### Real-time File Change Notifications

Add MCP notifications for real-time updates:

```kotlin
// In ActiveFileService.kt
private fun updateActiveFile(file: VirtualFile) {
    currentFile = file

    // Send MCP notification (if WebSocket support is added)
    val notification = mapOf(
        "method" to "activeFileNotification",
        "params" to mapOf(
            "filePath" to file.path,
            "cursor" to mapOf(
                "line" to currentLine,
                "character" to currentColumn
            )
        )
    )

    // Send notification to connected MCP clients
    sendNotificationToClients(notification)
}
```

### Multi-project Support

Handle multiple open projects:

```kotlin
fun getActiveFileInfo(): String {
    val projects = ProjectManager.getInstance().openProjects
    val activeProject = projects.find { project ->
        FileEditorManager.getInstance(project).selectedFiles.isNotEmpty()
    }

    return if (activeProject != null) {
        val fileManager = FileEditorManager.getInstance(activeProject)
        val selectedFile = fileManager.selectedFiles.firstOrNull()
        if (selectedFile != null) {
            "Active file: ${selectedFile.path} (project: ${activeProject.name}, line: $currentLine, char: $currentColumn)"
        } else {
            "No file is currently active"
        }
    } else {
        "No file is currently active"
    }
}
```

## Benefits of This Approach

1. **Standard Protocol**: Uses MCP instead of custom API
2. **IDE Agnostic**: Gemini CLI doesn't need JetBrains-specific code
3. **Maintainable**: Plugin handles all IDE-specific logic
4. **Extensible**: Can add more MCP tools without changing Gemini CLI
5. **Testable**: Can test MCP server independently

## Next Steps

1. Add more MCP tools (workspace information, debugging context)
2. Implement WebSocket transport for better performance
3. Add configuration UI in the plugin
4. Support for multiple file contexts
5. Integration with JetBrains debugging APIs

This example demonstrates how the protocol-first architecture enables rich IDE integration while keeping the core Gemini CLI simple and IDE-agnostic.
