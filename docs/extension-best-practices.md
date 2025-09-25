# Extension Best Practices

This guide will help you decide when to use different components of the Gemini CLI extension framework to build powerful and maintainable extensions.

## Overview of Components

There are three main ways to extend the Gemini CLI:

1.  **MCP Server:** A server that exposes custom tools for the model to use. This is the most powerful and flexible option.
2.  **Custom Commands:** Simple, standalone commands defined in `gemini-extension.json` that can be executed from the command line.
3.  **`gemini.md`:** A Markdown file that provides static, foundational context to the model's system prompt.

## When to Use an MCP Server

We broadly recommend using an MCP server for most extension logic. It provides the most robust and future-proof way to add functionality.

**Use an MCP Server when:**

- **You have complex logic:** If your extension needs to make API calls, interact with a database, access the file system, or perform any non-trivial computations, an MCP server is the right choice.
- **You want to create custom tools for the model:** The core of the MCP server is defining tools that the AI model can intelligently decide to use. This allows for natural language interaction with your extension's capabilities.
- **You want maximum compatibility:** Exposing your logic as tools via an MCP server makes your extension compatible with many different clients and interfaces, not just the Gemini CLI. If you already have an MCP server, we recommend using MCP server prompts in lieu of custom commands if the command can be modeled as a prompt.

## When to Use Custom Commands

Custom commands are best for when you can model all of your functionality via custom prompting. This can include calls to core tools or associated MCP servers. Custom commands are a powerful option, and also require less overhead and no build or release processes.

**Use custom commands when:**

- **You need simple, standalone functionality:** If you want to add a straightforward command that performs a specific action without AI interaction (e.g., a command to scaffold a new project file), a custom command is a great fit.
- **Your logic is minimal:** Custom commands are powerful but are not designed to house complex business logic.

## When to Use `gemini.md`

The `gemini.md` file is a powerful tool for providing static context to the model, but it should be used judiciously. Its contents are added to the system prompt, influencing the model's behavior and knowledge for all subsequent interactions.

**Use `gemini.md` when:**

- **You need to provide foundational knowledge:** It's a good place to document stable information about an API, a proprietary programming language, or specific domain knowledge that the model will need to effectively use your other extension components.
- **You want to set ground rules or style guides:** You can provide instructions on how the model should behave or format its output when interacting with your extension.

**Important Considerations for `gemini.md`:**

- **Use Sparingly:** The content of `gemini.md` is combined with all other active `gemini.md` context files. Overloading it can dilute the model's focus and make it less effective.
- **Static Content Only:** It is not suitable for information that changes frequently. For dynamic information that needs to be fetched in real-time (e.g., the status of a service), you should expose that via a tool in an MCP server.
- **Not for Prompts:** `gemini.md` provides background context; it is not a mechanism for defining interactive, user-facing prompts.

## Combining Components

The most powerful extensions often combine these components. A common pattern is to build the core logic as tools in an **MCP Server** and then provide high-level documentation or style guides in a **`gemini.md`** file to help the model use those tools more effectively. A **Custom Command** could then be used to provide a simple entry point for a common workflow that utilizes the MCP server.

## Controlling Tool Access

Your extension can fine-tune the tools available to the model. This is useful for creating a more controlled experience, preventing your extension's tools from conflicting with core tools, or exposing only a subset of a larger toolset from an MCP server.

### Excluding Core Tools

You can prevent certain core Gemini CLI tools from being available when your extension is active. This can be useful to avoid conflicts or to restrict functionality. In your `gemini-extension.json`, use the top-level `excludeTools` property.

**Example: Disabling the `write_file` tool**

```json
{
  "name": "my-secure-extension",
  "version": "1.0.0",
  "excludeTools": ["write_file"]
}
```

You can also add command-specific restrictions for tools that support it, like `run_shell_command`.

**Example: Blocking a specific shell command**

```json
{
  "name": "my-secure-extension",
  "version": "1.0.0",
  "excludeTools": ["run_shell_command(rm -rf)"]
}
```

### Managing Tools from an MCP Server

When your extension provides an MCP server, you might not want to expose all of its tools to the model. You can use the `includeTools` and `excludeTools` properties within the server's configuration to create an allowlist or denylist. This

- `includeTools`: Only the tools in this list will be made available.
- `excludeTools`: All tools _except_ for the ones in this list will be made available.

**Note:** `excludeTools` takes precedence over `includeTools`.

**Example: Including only specific tools from a server**

This configuration connects to `my-api-server` but only exposes the `list_users` and `get_user_details` tools to the model.

```json
{
  "name": "my-api-extension",
  "version": "1.0.0",
  "mcpServers": {
    "my-api-server": {
      "command": "node my-api-server.js",
      "includeTools": ["list_users", "get_user_details"]
    }
  }
}
```

**Example: Excluding a sensitive tool from a server**

This configuration exposes all tools from `my-api-server` _except_ for the `delete_user` tool.

```json
{
  "name": "my-api-extension",
  "version": "1.0.0",
  "mcpServers": {
    "my-api-server": {
      "command": "node my-api-server.js",
      "excludeTools": ["delete_user"]
    }
  }
}
```
