# Specification: ANSI Color Support for Terminal Emulation

This document outlines the plan to add support for ANSI color and text styling to the terminal emulation feature in the Gemini CLI.

## 1. Goals

-   Enable the rendering of ANSI escape codes for colors and text styles (e.g., bold, underline) in the terminal output.
-   Ensure that the CLI's UI is not disrupted by the introduction of these escape codes.
-   Maintain the correct cursor position and text alignment in the `TerminalOutput` component.
-   Provide a more visually informative and aesthetically pleasing terminal experience for the user.

## 2. Technical Approach

The implementation will be divided into three main parts:

1.  **Terminal State Serialization**: A new utility will be created to serialize the state of the headless terminal buffer from `@xterm/headless` into a string that includes ANSI escape codes for colors and text styles.
2.  **Service Layer Integration**: The `ShellExecutionService` will be updated to use this new serializer. For the fallback execution path (which does not use a PTY), raw ANSI codes will be passed through to the output.
3.  **UI Layer Adaptation**: The `TerminalOutput` React component will be updated to correctly handle strings containing ANSI escape codes, ensuring that the cursor is rendered correctly and that the text is properly aligned.

### 2.1. Terminal State Serialization (`terminalSerializer.ts`)

A new file, `packages/core/src/utils/terminalSerializer.ts`, will be created. This file will contain a function, `serializeTerminalToString`, that takes an `@xterm/headless` `Terminal` instance as input and returns a string.

This function will iterate through each cell of the terminal's buffer and generate the corresponding ANSI escape codes for:

-   Foreground and background colors (including 256-color palette and RGB colors).
-   Text attributes (bold, italic, underline, dim, inverse).
-   The cursor position (which will be rendered using the inverse attribute).

### 2.2. Service Layer Integration (`shellExecutionService.ts`)

The `ShellExecutionService` will be modified in the following ways:

-   The `executeWithPty` method will be updated to use the new `serializeTerminalToString` function to generate the output string.
-   The `childProcessFallback` method will be modified to no longer strip ANSI escape codes from the output. This will allow commands that produce color output to be rendered correctly even when a PTY is not available.

### 2.3. UI Layer Adaptation (`TerminalOutput.tsx`)

The `TerminalOutput` component will be updated to correctly handle strings containing ANSI escape codes. This will require the addition of a new dependency, `slice-ansi`, to the `packages/cli` package.

The `slice-ansi` library will be used to correctly calculate the substring of the line that is before and after the cursor, without breaking the ANSI escape codes. This will ensure that the cursor is rendered in the correct position and that the colors and styles of the text are preserved.

## 3. Dependency Management

The `slice-ansi` package will be added as a dependency to the `packages/cli` package. This will be done by running `npm install slice-ansi` in the `packages/cli` directory.
