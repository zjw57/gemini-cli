# Design Doc: Interactive Shell Tool UI

## 1. Objective

To enhance the `ShellTool` by providing an interactive terminal-like experience directly within the CLI's UI. When a shell command is executing, an input field will appear within the tool's output display. Users will be able to focus this input using a hotkey (`Ctrl+T`) and send data (e.g., responding to prompts, sending signals like `Ctrl+C`) to the running process. This creates a seamless workflow for interactive shell commands without leaving the Gemini CLI interface.

## 2. Background

Currently, the `ShellTool` can only execute non-interactive commands. It streams stdout, but there is no mechanism for the user to provide stdin to the running process. This limits the tool's utility, as it cannot be used for commands that require user input (e.g., `read`, `ssh`, `git commit`) or for managing long-running processes that might need to be interrupted. This feature aims to bridge that gap by introducing a pseudo-terminal (PTY) based execution model and a dedicated UI for interaction.

## 3. High-Level Design

The solution is divided into two main areas: the backend service responsible for process execution and the frontend UI components that render the interactive session.

1.  **Backend (`@google/gemini-cli-core`):** The `ShellExecutionService` will be updated to use `node-pty` to spawn commands in a pseudo-terminal. This provides a mechanism for two-way communication. A fallback to the standard `child_process` will be maintained for environments where a PTY cannot be created. The service will expose static methods for writing to and resizing the PTY, managed via the process ID (PID).

2.  **Frontend (`@google/gemini-cli`):** The main `App.tsx` component will manage the state of the active interactive shell session, including its PTY ID and whether the user has focused the embedded input. A new `ShellInputPrompt.tsx` component will be created to capture raw keypresses and forward them to the backend. Existing components (`ToolMessage.tsx`, `ToolGroupMessage.tsx`) will be modified to conditionally render this new input and reflect its focused state.

Communication between the frontend and backend will be handled through the `GeminiClient`, which will be extended with methods to call the `ShellExecutionService`.

## 4. Detailed Design

### 4.1. Backend Implementation

#### 4.1.1. `ShellExecutionService`

The `ShellExecutionService` is the core of the backend logic.

-   **Execution Strategy:** It will attempt to execute commands using `node-pty` first. If `node-pty` fails to initialize, it will fall back to using `child_process.spawn`.
-   **PTY Lifecycle:** When a PTY is successfully created, it is stored in a static `Map<number, ActivePty>` keyed by its PID. This map holds the `ptyProcess` instance and a headless `xterm` instance for processing the output. The PTY is removed from the map upon process exit.
-   **Fallback Mechanism:** When falling back to `child_process`, the returned `ShellExecutionHandle` will intentionally have a `pid` of `undefined`. This acts as a signal to the UI to disable interactive features for that specific command.
-   **API:** The service will expose three static methods:
    -   `execute(...)`: The existing method, now with PTY logic.
    -   `writeToPty(pid: number, input: string)`: Looks up the PTY by its PID in the active PTYs map and writes the provided input string (which can be a raw character or an ANSI sequence) to it.
    -   `resizePty(pid: number, cols: number, rows: number)`: Resizes the specified PTY.

#### 4.1.2. `GeminiClient`

The `GeminiClient` will act as the bridge between the UI and the `ShellExecutionService`. It will be updated with two new methods:

-   `writeToShell(pid: number, input: string)`: Calls `ShellExecutionService.writeToPty`.
-   `resizeShell(pid: number, cols: number, rows: number)`: Calls `ShellExecutionService.resizePty`.

### 4.2. Frontend Implementation

#### 4.2.1. State Management in `App.tsx`

`App.tsx` will be the source of truth for the interactive shell state.

-   `activeShellPtyId: number | null`: This state holds the PID of the currently active and executing shell tool. It is derived by memoizing over the `pendingHistoryItems` list and finding a tool that is executing and has a `ptyId`.
-   `shellInputFocused: boolean`: This state tracks whether the user has activated the embedded shell input via the hotkey. It is set to `false` automatically when `activeShellPtyId` becomes `null`.

#### 4.2.2. User Interaction and Keybindings

-   **Focus Toggling:** A global keypress handler in `App.tsx` will listen for `Ctrl+T`. When pressed, it will toggle the `shellInputFocused` state, but only if `activeShellPtyId` is not `null`.
-   **Input Disabling:** The main `InputPrompt` at the bottom of the screen will be disabled (`isActive={!shellInputFocused}`) whenever the embedded shell input is focused, preventing dual input.
-   **Keybinding Change:** To avoid conflict, the "Toggle Tool Descriptions" command will be moved from `Ctrl+T` to `Ctrl+I`.

#### 4.2.3. UI Components

-   **`ShellInputPrompt.tsx` (New Component):**
    -   **Purpose:** A minimal component designed to capture raw keypresses and forward them.
    -   **Functionality:** It uses the `useKeypress` hook to listen for input. Each keypress is converted into its corresponding character or ANSI escape sequence by a `keyToAnsi` utility function. The resulting string is then passed to the `onSubmit` prop.
    -   **Display:** It renders only a blinking cursor to indicate that it is active and focused.

-   **`ToolMessage.tsx` (Modified):**
    -   **Props:** It will receive `activeShellPtyId`, `shellInputFocused`, and `onShellInputSubmit` from `App.tsx`.
    -   **Conditional Rendering:** It will check if its own `ptyId` matches `activeShellPtyId` and if its status is `Executing`. If true, it will render the `ShellInputPrompt`.
    -   **Focus Indicator:** It will also display a `[Focused]` text label next to the tool name and change its border color to provide a clear visual cue to the user.

-   **`ToolGroupMessage.tsx` (Modified):**
    -   This component will be responsible for passing the new props down to `ToolMessage`.
    -   It will also adjust its border color based on whether the shell input within it is focused.

#### 4.2.4. Data Flow (Prop Drilling)

The new state and handlers will be passed down the component tree:
`App.tsx` -> `HistoryItemDisplay.tsx` -> `ToolGroupMessage.tsx` -> `ToolMessage.tsx`

The `ptyId` for each shell command is added to the `IndividualToolCallDisplay` type. It is populated in the `useReactToolScheduler` hook via a new `pidUpdateHandler` callback that is passed down through the `CoreToolScheduler`.

## 5. Testing Plan

The feature will be validated through a series of manual tests designed to cover the primary use cases.

1.  **Interactive Input:**
    -   **Command:** `run_shell_command(command='read -p "Enter your name: " name && echo "Hello, $name"')`
    -   **Steps:**
        1.  Execute the command.
        2.  Verify the embedded input prompt appears.
        3.  Press `Ctrl+T` to focus the input.
        4.  Type a name and press Enter.
    -   **Expected Result:** The shell output should update to show "Hello, [name]".

2.  **Process Interruption:**
    -   **Command:** `run_shell_command(command='sleep 1000')`
    -   **Steps:**
        1.  Execute the command.
        2.  Press `Ctrl+T` to focus the input.
        3.  Press `Ctrl+C`.
    -   **Expected Result:** The shell process should terminate, and the tool's status should update from `Executing` to `Success` or `Error`.

3.  **Focus Management:**
    -   **Steps:**
        1.  Start an interactive command.
        2.  Verify `Ctrl+T` toggles focus between the main application input and the embedded shell input.
        3.  Verify the main input prompt remains visible but is non-interactive when the shell input is focused.

4.  **Preflight Check:**
    -   Run `npm run preflight` to ensure all automated checks (build, lint, types, tests) pass.
