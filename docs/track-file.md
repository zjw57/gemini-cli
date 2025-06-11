# Proposal: Ambient File Context for Enhanced AI Collaboration

A simple test for this feature: ask the model to add a pithy remark to this file, and that we'll continue iterating on it. The model should use `track_file` and not `read_file`.

> A feature to ensure we're always on the same page. Literally.

> The only thing worse than no context is stale context.

> The source of truth is the file on disk, not the scrollback buffer.

- **Authors**: User, Gemini
- **Status**: Draft
- **Date**: 2025-06-10

## Summary

This proposal introduces a new "ambient context" model for managing file contents during an interactive session with the Gemini AI assistant. Instead of relying on imperative, one-off `ReadFile` tool calls whose content becomes stale, we propose a system where the AI can add and remove files from a persistent context. The contents of these "tracked" files will be read fresh from disk and provided to the AI on every conversational turn, ensuring it always operates on the most up-to-date information.

## Problem Statement

The current interaction model requires the AI to explicitly call a `ReadFile` tool to access a file's content. This has several significant drawbacks:

1.  **Stale Context**: The file's content is injected into the conversation history at a single point in time. If the user edits the file in their IDE or if a subsequent tool call modifies it, the AI's historical context becomes outdated. This forces the AI to re-read the file repeatedly and can lead to confusion, incorrect assumptions, and flawed code modifications.
2.  **Conversational Noise**: The full text of a file from a `ReadFile` call clutters the prompt history. This makes reviewing the interaction difficult for both the user and the AI, and it consumes valuable token space with information that is often redundant or stale.
3.  **Inefficiency for Complex Tasks**: For any task requiring changes across multiple files, the AI must perform numerous `ReadFile` calls, often re-reading the same files multiple times to ensure its understanding is current. This is a slow and cumbersome process.

## Proposed Solution

We propose the introduction of an "ambient file context" managed by two new tools:

-   `track_file(path: string)`: Adds a file to the ambient context.
-   `untrack_file(path: string)`: Removes a file from the ambient context.

### How it Works

1.  **Context Management**: The user and the AI can add or remove files from a session-specific context list using the `track_file` and `untrack_file` tools.
2.  **Fresh Content on Every Turn**: On every conversational turn, the system will read the latest contents of all files currently in the context list directly from the disk.
3.  **Prompt Augmentation**: This collection of fresh file content will be appended to the prompt sent to the AI, along with the list of tracked file paths. This gives the AI a complete and always-current view of its working "workspace."

### Workflow Example

Consider a user asking the AI to refactor a feature.

1.  **Discovery**: The AI uses `glob` or `search_file_content` to identify the relevant files (e.g., `packages/cli/src/ui/App.tsx` and `packages/core/src/core/client.ts`).
2.  **Context Loading**: The AI calls `track_file` for both files.
    ```
    [tool_code: track_file('packages/cli/src/ui/App.tsx')]
    [tool_code: track_file('packages/core/src/core/client.ts')]
    ```
3.  **Modification**: The AI now has the content of both files available on every turn. It can reason about the necessary changes and use the `replace` tool. If the user makes a manual edit between turns, the AI will see that change automatically on the next turn.
4.  **Task Completion & Cleanup**: Once the refactoring is complete and verified, the AI cleans up its context.
    ```
    [tool_code: untrack_file('packages/cli/src/ui/App.tsx')]
    [tool_code: untrack_file('packages/core/src/core/client.ts')]
    ```

## Gemini's Perspective

As the AI model that would operate within this new paradigm, I wholeheartedly endorse this proposal. This change represents a fundamental improvement to my core capabilities and aligns my workflow much more closely with that of a human developer.

The primary benefit is **accuracy**. The "stale context" problem is a significant handicap that forces me to be overly cautious and re-verify information constantly. By receiving fresh file content on every turn, my confidence in the state of the codebase will be much higher, leading to more reliable and precise modifications. I can spend less time verifying and more time reasoning about the task at hand.

Furthermore, this model enhances my **efficiency** on complex, multi-file tasks. The ability to "keep files open" mirrors a developer's mental model of a workspace. It will allow me to build a holistic understanding of how different parts of the code interact, ensuring that my changes are consistent and well-integrated.

I am confident in my ability to manage this context effectively. My logic would naturally extend to a "setup, execute, teardown" pattern for each task: tracking the necessary files, performing the work, and untracking them upon completion. This would not only be a more powerful way to work but would also result in a cleaner, more intent-driven conversational history.

In short, the proposed ambient context model would be a transformative upgrade, directly addressing current limitations and unlocking a higher level of performance and reliability.
