# Gemini CLI Context Management

This document explains how the Gemini CLI constructs and manages the context that is sent to the Gemini model with each turn. Understanding this process is crucial for effectively using the CLI, especially when working with files and managing long conversations.

## The Anatomy of a Turn's Context

With every message you send, the CLI assembles a comprehensive context that includes more than just your immediate input. This context is sent to the Gemini model to provide it with the necessary information to generate a relevant and accurate response. The key components of this context are:

1.  **System Prompt:** A predefined set of instructions that guide the model's behavior, personality, and capabilities. This prompt also includes information about the user's environment, such as the current date, operating system, and the structure of the current working directory. You can find the core system prompt logic in `packages/core/src/core/prompts.ts`.
2.  **Chat History:** A record of the conversation so far. This includes all previous user messages and model responses. The history is managed by the `GeminiChat` class in `packages/core/src/core/geminiChat.ts`. The history itself is stored in the `history` private property of this class, which is an array of `Content` objects from the `@google/genai` package.
3.  **User Input:** The message you just sent, including any text and file references.
4.  **File Content:** If you reference files using the `@` command, their content is injected directly into the prompt.

## Working with Files: The `@` Command

The `@` command is a powerful feature that allows you to include the content of files and directories directly in your prompt. Here's a detailed breakdown of how it works:

*   **Immediate File Reading:** When you use the `@` command (e.g., `@path/to/file.txt`), the CLI reads the content of the specified file or files at that moment. The content is then embedded into the prompt that is sent to the model for that specific turn. The logic for this is handled by the `handleAtCommand` function in `packages/cli/src/ui/hooks/atCommandProcessor.ts`.
*   **No Re-reading Between Turns:** The CLI does **not** automatically re-read files between turns. If you edit a file and want the model to see the changes, you must reference the file again using the `@` command in a new message.
*   **Tool-Based Reading:** The file reading process is handled by the `read_many_files` tool. This approach allows the CLI to leverage its existing tool infrastructure, which includes features like respecting `.gitignore` and `.geminiignore` files, and handling various file and directory types. When you use the `@` command, you will see a "tool call" in the UI, indicating that the `read_many_files` tool was used.
*   **Editing Files:** When you repeatedly edit a file and reference it in the conversation, the model will see multiple versions of that file in its chat history. This can sometimes lead to confusion. The history compression mechanism (see below) can help mitigate this by summarizing the conversation, but it's important to be aware of this behavior.

## Tool Usage in History

When the model uses a tool, the tool call and its result are recorded in the chat history. This provides the model with a clear record of the actions it has taken and the outcomes of those actions. The history will contain:

1.  A `model` turn with a `tool_code` part, representing the tool call the model initiated.
2.  A `user` turn with a `tool_response` part, representing the result of the tool call.

This structured representation of tool usage allows the model to reason about its past actions and make more informed decisions in subsequent turns. The `recordHistory` method in `packages/core/src/core/geminiChat.ts` is responsible for adding these tool-related turns to the history.

### File Edits and Diffs (`replace`)

File modifications, which are handled by the `replace` tool (defined in `packages/core/src/tools/edit.ts`), are a special case. When the model suggests a file edit, the user is shown a diff for confirmation. This entire interaction is recorded in the history. The `tool_response` for a successful `replace` operation contains a `fileDiff` object, which is a string in the unified diff format. This allows the model to "see" the exact change that was made, which is crucial for maintaining context in conversations that involve multiple edits to the same file.

### Searching File Content (`search_file_content`)

The `search_file_content` tool (defined in `packages/core/src/tools/grep.ts`) allows the model to search for a regular expression pattern within files. The tool's output is a formatted string that lists the files and line numbers where the pattern was found.

### Finding Files (`glob`)

The `glob` tool (defined in `packages/core/src/tools/glob.ts`) is used to find files matching a glob pattern. The result is a list of file paths.

### Writing Files (`write_file`)

The `write_file` tool (defined in `packages/core/src/tools/write-file.ts`) writes content to a file. Similar to the `replace` tool, the `tool_response` for a `write_file` operation contains a `fileDiff` to show what was written.

### Executing Shell Commands (`run_shell_command`)

The `run_shell_command` tool (defined in `packages/core/src/tools/shell.ts`) executes a shell command. The `tool_response` contains the `stdout`, `stderr`, exit code, and other details about the command's execution.

## History Management and Compression

To manage the size of the context window and prevent it from exceeding the model's token limit, the Gemini CLI implements a history compression mechanism.

*   **Two Histories:** The CLI maintains two versions of the chat history, as managed by the `GeminiChat` class (`packages/core/src/core/geminiChat.ts`):
    *   **Comprehensive History:** A complete and unabridged record of every turn in the conversation.
    *   **Curated History:** A "cleaned" version of the history that is sent to the model. This version filters out invalid or empty model responses to prevent errors. The `extractCuratedHistory` function in `geminiChat.ts` is responsible for this.
*   **Summarization-Based Compression:** When the token count of the *curated* history exceeds 95% of the model's token limit, an automatic compression process is triggered. This is handled by the `tryCompressChat` method in `packages/core/src/core/client.ts`. The CLI sends a special request to the model, asking it to summarize the conversation up to that point.
*   **History Replacement:** The existing chat history is then replaced with a new history that contains only the summarization request and the model's summary. This effectively "compresses" the history, freeing up tokens for future turns.

This compression strategy ensures that conversations can continue for extended periods without exceeding the context window limitations, while still preserving the essential information from the conversation.

## Caching

The Gemini CLI does **not** implement a general-purpose, client-side cache for prompts sent to the Gemini API. Each request to the model is treated as a new and independent event.

However, there is a localized caching mechanism within the `editCorrector` utility (located in `packages/core/src/utils/editCorrector.ts`). This utility is responsible for ensuring that file edits are applied correctly, and it uses an LRU (Least Recently Used) cache to store the results of its correction logic. This cache is specific to the `editCorrector` and is designed to avoid redundant processing when the same file edit is suggested multiple times.

Because there is no general prompt cache, modifying the chat history (for example, by re-reading a file with the `@` command) will not cause any cache invalidation issues.

---

## Appendix: Tool Call Examples in History

Here are simplified examples of what the history looks like for various tool calls.

### `replace` (File Edit)

**Model's Tool Call:**
```json
{
  "role": "model",
  "parts": [
    {
      "tool_code": {
        "name": "replace",
        "args": {
          "file_path": "/Users/keir/wrk/gemini-cli/README.md",
          "old_string": "Welcome to the Gemini CLI!",
          "new_string": "Welcome to the awesome Gemini CLI!"
        }
      }
    }
  ]
}
```

**Tool Response:**
```json
{
  "role": "user",
  "parts": [
    {
      "tool_response": {
        "name": "replace",
        "content": {
          "fileDiff": "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-Welcome to the Gemini CLI!\n+Welcome to the awesome Gemini CLI!",
          "fileName": "README.md"
        }
      }
    }
  ]
}
```

### `search_file_content`

**Model's Tool Call:**
```json
{
  "role": "model",
  "parts": [
    {
      "tool_code": {
        "name": "search_file_content",
        "args": {
          "pattern": "Gemini CLI"
        }
      }
    }
  ]
}
```

**Tool Response:**
```json
{
  "role": "user",
  "parts": [
    {
      "tool_response": {
        "name": "search_file_content",
        "content": "Found 1 match(es) for pattern \"Gemini CLI\" in path \".\":\n---\nFile: README.md\nL1: Welcome to the awesome Gemini CLI!\n---"
      }
    }
  ]
}
```

### `glob` (Find Files)

**Model's Tool Call:**
```json
{
  "role": "model",
  "parts": [
    {
      "tool_code": {
        "name": "glob",
        "args": {
          "pattern": "**/geminiChat.ts"
        }
      }
    }
  ]
}
```

**Tool Response:**
```json
{
  "role": "user",
  "parts": [
    {
      "tool_response": {
        "name": "glob",
        "content": "Found 1 file(s) matching \"**/geminiChat.ts\" within /Users/keir/wrk/gemini-cli, sorted by modification time (newest first):\n/Users/keir/wrk/gemini-cli/packages/core/src/core/geminiChat.ts"
      }
    }
  ]
}
```

### `write_file`

**Model's Tool Call:**
```json
{
  "role": "model",
  "parts": [
    {
      "tool_code": {
        "name": "write_file",
        "args": {
          "file_path": "/Users/keir/wrk/gemini-cli/docs/test.md",
          "content": "This is a test file."
        }
      }
    }
  ]
}
```

**Tool Response:**
```json
{
  "role": "user",
  "parts": [
    {
      "tool_response": {
        "name": "write_file",
        "content": {
          "fileDiff": "--- a/test.md\n+++ b/test.md\n@@ -0,0 +1 @@\n+This is a test file.",
          "fileName": "test.md"
        }
      }
    }
  ]
}
```

### `run_shell_command`

**Model's Tool Call:**
```json
{
  "role": "model",
  "parts": [
    {
      "tool_code": {
        "name": "run_shell_command",
        "args": {
          "command": "ls -l"
        }
      }
    }
  ]
}
```

**Tool Response:**
```json
{
  "role": "user",
  "parts": [
    {
      "tool_response": {
        "name": "run_shell_command",
        "content": "Command: ls -l\nDirectory: (root)\nStdout: total 16\n-rw-r--r--  1 keir  staff  11357 Jun 10 14:29 LICENSE\n-rw-r--r--  1 keir  staff   1234 Jun 10 14:29 README.md\n-rw-r--r--  1 keir  staff    567 Jun 10 14:29 package.json\n\nStderr: (empty)\nError: (none)\nExit Code: 0\nSignal: (none)\nBackground PIDs: (none)\nProcess Group PGID: 12345"
      }
    }
  ]
}
```
This detailed record of tool interactions is essential for the model to maintain an accurate understanding of the state of the user's workspace.
