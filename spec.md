# Revised Detailed Plan for Interactive ShellTool Response UI

**Objective:** To display an Ink input field _at the bottom of the `ShellTool` response_ when it's in an "executing" state, simulating an embedded terminal. The main application input prompt will remain visible. Users can focus this embedded input by pressing `Ctrl+T` and send input (e.g., responding to prompts, sending `Ctrl+C`) to the running process.

**Phase 1: Identify and Modify Relevant Components**

1.  **Identify `ShellTool` Rendering:**
    - `App.tsx`: The main application component. It will manage state and handle communication with the backend.
    - `ToolGroupMessage.tsx`: Renders a group of tool calls.
    - `ToolMessage.tsx`: Renders individual tool calls and will contain the embedded input.
    - `ShellInputPrompt.tsx`: A new, dedicated component for capturing raw key presses for the running shell process.

2.  **Identify Backend Services:**
    - `ShellExecutionService`: The core service that manages the shell command lifecycle. It uses `node-pty` for interactive sessions and falls back to `child_process` if a PTY cannot be created.
    - **Communication Bridge:** A mechanism within `GeminiClient` to pass messages from the UI to the `ShellExecutionService`.

**Phase 2: Integrate Embedded Input and Focus Logic in `App.tsx`**

1.  **Track Shell Execution State in `App.tsx`:**
    - Introduce a new state variable: `activeShellPtyId: number | null`, initialized to `null`.
    - This state is derived from `pendingHistoryItems`. It is set to the `ptyId` of a `ShellTool` when it is in the `ToolCallStatus.Executing` state.
    - **Note:** The `ptyId` will only be set for commands executed via `node-pty`. The `child_process` fallback intentionally does not receive a `pid`, disabling interactive features for non-PTY commands.

2.  **Manage Embedded `InputPrompt` Focus with `Ctrl+T`:**
    - Add a new state variable: `shellInputFocused: boolean`, initialized to `false`.
    - Update `handleGlobalKeypress` in `App.tsx`:
      - When `Ctrl+T` is pressed and `activeShellPtyId` is not `null`, `shellInputFocused` is toggled.
    - Pass `shellInputFocused` down to the `ToolMessage` containing the active shell.
    - The main `InputPrompt` is disabled when `shellInputFocused` is true.

3.  **Main `InputPrompt` Rendering:**
    - The existing `InputPrompt` in `App.tsx` remains, but its `isActive` prop is controlled by `!shellInputFocused` to prevent it from capturing input when the shell input is active.

**Phase 3: Implement Backend Communication**

1.  **Expose Input Method in `ShellExecutionService`:**
    - The `ShellExecutionService` exposes static methods to interact with active PTYs:
      - `writeToPty(pid: number, input: string)`: Writes a raw string or ANSI sequence to the PTY.
      - `resizePty(pid: number, cols: number, rows: number)`: Resizes the PTY.

2.  **Create Input Handler in `App.tsx`:**
    - Implement a handler function: `handleShellInputSubmit(input: string)`.
    - This function calls `config.getGeminiClient().writeToShell(activeShellPtyId, input)`.
    - The `GeminiClient` then calls the static `ShellExecutionService.writeToPty` method.
    - A `useEffect` hook in `App.tsx` also calls `resizeShell` whenever the terminal dimensions change.

3.  **Prop Drilling:**
    - Pass `activeShellPtyId`, `shellInputFocused`, and `handleShellInputSubmit` from `App.tsx` down to `ToolGroupMessage` and then to `ToolMessage`.
    - The `ptyId` for each tool is added to the `IndividualToolCallDisplay` type and passed down to `ToolMessage`.

**Phase 4: Conditionally Render and Connect the Embedded Input**

1.  **Modify `ToolMessage.tsx`:**
    - The component receives `activeShellPtyId`, `shellInputFocused`, and `onShellInputSubmit` as props.
    - It checks if its own `toolCall.ptyId` matches the `activeShellPtyId` and if the `status` is `ToolCallStatus.Executing`.
    - If both conditions are true, it renders the new `ShellInputPrompt` component.

2.  **Connect the Embedded `ShellInputPrompt`:**
    - **`focus`:** The `focus` prop is set to `shellInputFocused`.
    - **`onSubmit`:** The `onSubmit` prop calls `props.onShellInputSubmit(input)`. The component uses a `useKeypress` hook to capture raw key events and translates them to ANSI sequences via a `keyToAnsi` utility function.
    - **Styling:** A `[Focused]` indicator is shown next to the tool name when the embedded input is active. The border of the `ToolGroupMessage` also changes color to indicate focus.

**Phase 5: Refinements and Verification**

1.  **Key Bindings:**
    - The `TOGGLE_SHELL_INPUT_FOCUS` command is bound to `Ctrl+T`.
    - The `TOGGLE_TOOL_DESCRIPTIONS` command has been moved to `Ctrl+I` to avoid conflict.

2.  **Testing:**
    - **Manual Test Cases:**
      - **Input Prompt:** Run a command that requires user input (e.g., `run_shell_command(command='read -p "Enter your name: " name && echo "Hello, $name"')`).
        - Verify the embedded input appears.
        - Press `Ctrl+T`, type a name, and press Enter.
        - Confirm the shell output updates with the "Hello, [name]" message.
      - **Process Interruption:** Run a long-lived process (e.g., `run_shell_command(command='sleep 1000')`).
        - Press `Ctrl+T` to focus the embedded input.
        - Press `Ctrl+C`.
        - Verify the shell process terminates and the tool status changes from `Executing` to `Success` or `Failed`.
      - **Focus Management:**
        - Verify `Ctrl+T` correctly toggles focus between the main app and the shell input.
        - Verify the main input prompt at the bottom of the `App` _remains visible_ at all times but is inactive when the shell input is focused.
    - **Preflight Check:** Run `npm run preflight` to ensure no build, linting, or type-checking errors are introduced.

**Key Files to Modify:**

- `packages/cli/src/ui/App.tsx`
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`
- `packages/cli/src/ui/components/messages/ToolMessage.tsx`
- `packages/cli/src/ui/components/ShellInputPrompt.tsx`
- `packages/core/src/services/shellExecutionService.ts`
- `packages/core/src/core/client.ts`