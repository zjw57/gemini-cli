refactor(vscode): Improve IDE server communication file handling

## TLDR

This pull request refactors the communication mechanism between the VS Code extension and the Gemini CLI. Instead of writing two separate files directly into the system's temp directory, it now creates a single, process-specific JSON file within a dedicated `.gemini/ide` subdirectory. This improves the reliability of the IDE server discovery process.

Additionally, this PR includes minor fixes for cursor position reporting (changing to 1-based indexing) and simplifies how truncated text is handled.

## Dive Deeper

The previous implementation for IDE server discovery wrote two files to `os.tmpdir()`: one based on the port and another on the parent process ID (ppid). This approach was prone to issues, especially with multiple VS Code instances or improper cleanup, leading to stale files and incorrect connections.

This change introduces a more robust strategy:
- **Scoped Directory:** A `.gemini/ide` directory is now created within `os.tmpdir()` to centralize communication files and avoid polluting the root temp folder.
- **PID-Specific Files:** The communication file is now named `gemini-ide-server-${process.pid}-${port}.json`, making it unique to the specific VS Code extension process. This eliminates ambiguity and prevents the CLI from connecting to a stale or incorrect server instance.
- **Simplified Logic:** The concept of a `ppid`-based file has been removed entirely, streamlining the logic for both the extension and the CLI.
- **Error Handling:** The code now gracefully handles potential failures during the creation of the communication file, ensuring that environment variables are still set so the CLI can function as a fallback.

The cursor character is now reported as 1-based instead of 0-based for better consistency. The `... [TRUNCATED]` suffix on oversized selected text has been removed to simplify parsing on the client side.

## Reviewer Test Plan

1.  Launch the VS Code extension from source.
2.  Check your system's temporary directory for a new folder: `.../tmp/.gemini/ide`.
3.  Verify that a file named `gemini-ide-server-<pid>-<port>.json` exists inside this folder.
4.  Confirm the contents of the JSON file are correct, containing the server port and workspace path.
5.  In your terminal, run `gemini context` and ensure it successfully connects to the running IDE instance.
6.  Open a file in VS Code, place your cursor, and run `gemini context` again. Verify the `cursor.character` value is 1-based (e.g., the first character is `1`, not `0`).
7.  Select a very large block of text (over 16kb) and check that the `selectedText` in `gemini context` is truncated without the `... [TRUNCATED]` suffix.
8.  Close VS Code and confirm that the `gemini-ide-server-<pid>-<port>.json` file is automatically deleted.

## Linked Issues

#4800
