# Gemini CLI GUI

The Gemini CLI GUI provides a graphical interface for interacting with the Gemini model. While it's under active development, it currently supports sending messages and receiving responses, including tool calling.

![Demo](./resources/Demo.gif)

## Features

### Shell Mode

The GUI now supports executing terminal commands directly from the input field.

-   **Activate Shell Mode**: Press `Shift` + `!` to enter Shell Mode. The input area will be highlighted with an orange border.
-   **Execute Commands**: Type any shell command (e.g., `ls -l`, `pwd`) and press Enter.
-   **Change Directory**: Use the `cd <directory>` command to change the current working directory.
-   **Deactivate Shell Mode**: Press `Shift` + `!` again to exit Shell Mode.

## Missing Features

The following features from the command-line version are not yet implemented:

*   Slash commands (e.g., `/help`, `/test`)
*   `@` file selection for context
*   ...

## How to Run

To run the Gemini CLI GUI, follow these steps:

1.  Navigate to the `packages/cli-gui` directory:
    ```bash
    cd packages/cli-gui
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

3.  Start the application:
    ```bash
    npm start
    ```
