# Feature Spec: Gemini CLI Desktop GUI

## 1. Objective

To create a user-friendly, cross-platform desktop application for the Gemini CLI. This application will provide a graphical user interface (GUI) for interacting with the Gemini model, eliminating the need for terminal usage. The primary goal is to make the power of the Gemini CLI accessible to non-advanced users who prefer a visual interface over a command-line one.

## 2. Target Audience

Users who are unfamiliar or uncomfortable with command-line interfaces but wish to leverage Gemini's capabilities for tasks like code generation, general queries, and interacting with their local file system through the model.

## 3. Proposed Architecture & Technology

A robust and performant approach is to build the desktop application on a modern framework and directly integrate with the existing core logic of the CLI.

*   **Technology Stack:**
    *   **Framework:** **Electron**. It allows us to build a cross-platform desktop app using web technologies (HTML, CSS, JavaScript/TypeScript) and has excellent Node.js integration. This is a natural fit since the entire existing project is built on Node.js and TypeScript.
    *   **UI Library:** **React**. The team is already familiar with React from using `ink` for the terminal UI. We can leverage this expertise and potentially reuse UI component logic.
    *   **Core Logic Integration:** The desktop app will be a new package within the existing monorepo (e.g., `packages/desktop-app`). It will directly import and utilize the `@google/gemini-cli-core` package. This allows the GUI to call the same underlying functions for model interaction, tool execution, and configuration management that the CLI uses, ensuring consistency and high performance.

*   **Communication Layer:**
    *   The Electron **Main process** will handle window management and all Node.js-based backend operations, such as calling the `@google/gemini-cli-core` library.
    *   The Electron **Renderer process** will be responsible for rendering the React-based UI.
    *   Communication between the Main and Renderer processes will happen via Electron's Inter-Process Communication (IPC) channels (`ipcMain` and `ipcRenderer`).

## 4. UX Flow & UI Details

*   **Initial View: The Dashboard**
    *   Upon launching the application, the user is presented with a "Dashboard" view.
    *   This screen features a prominent **"Create New Task"** button at the top.
    *   Below this button, a list or grid of **"Previous Sessions"** is displayed. Each item in the list would show a preview of the session (e.g., the first user prompt) and a timestamp, allowing the user to easily resume a past conversation.

*   **Starting a New Task: The Chat View**
    *   Clicking "Create New Task" or a previous session navigates the user to the main "Chat View".
    *   This view contains the conversation history, a text input for new prompts, and a "Send" button.

*   **Rendering Content:**
    *   **Markdown:** Model responses will be rendered as rich text, with support for lists, bold/italic text, and other Markdown formatting.
    *   **Code Blocks:** Code snippets will be displayed in formatted blocks with language-appropriate syntax highlighting. A "Copy" button will be included on each code block for convenience, mimicking the CLI's output style.

## 5. Milestones & Task Breakdown

This project can be broken down into four main milestones.

---

### Milestone 1: Foundational Setup & Core Chat

*(Goal: A basic, functional chat application that can send a prompt and display a response, including the new dashboard flow.)*

*   **Task 1: Project Scaffolding**
    *   Set up a new Electron application within the monorepo under `packages/desktop-app`.
    *   Configure Electron Forge or a similar builder for TypeScript and React.
    *   Establish the basic Main and Renderer process structure.

*   **Task 2: UI Scaffolding & Navigation**
    *   Implement a basic router (e.g., `react-router-dom`) for the Renderer process.
    *   Create the "Dashboard" view component with a placeholder for "Previous Sessions" and a functional "Create New Task" button.
    *   Create the "Chat View" component.

*   **Task 3: Core Logic Integration**
    *   Create an IPC bridge to allow the Chat View (Renderer) to send a prompt to the Main process.
    *   In the Main process, import and use `@google/gemini-cli-core` to send the prompt to the Gemini API.
    *   Return the response to the UI via IPC.

*   **Task 4: Basic UI Implementation**
    *   In the Chat View, implement a text input for the user's prompt and a "Send" button.
    *   Create a display area to render the model's response as plain text.

---

### Milestone 2: Enhancing the User Experience

*(Goal: Make the application feel like a modern chat app with essential features.)*

*   **Task 1: Streaming Responses**
    *   Modify the IPC bridge to handle streaming responses from the Gemini API.
    *   Update the UI to display the response token-by-token, creating a "typing" effect.

*   **Task 2: Chat & Session History**
    *   Implement state management in the React application to store and display the conversation history for the active session.
    *   Implement a mechanism to persist sessions to disk (e.g., in a local JSON file or SQLite database).
    *   Populate the "Dashboard" view with the list of saved sessions.

*   **Task 3: Markdown & Code Rendering**
    *   Integrate a Markdown rendering library (e.g., `react-markdown`).
    *   Add a syntax highlighting library (e.g., `react-syntax-highlighter`) to render code blocks with a "Copy" button.

*   **Task 4: Error Handling & Loading States**
    *   Display clear loading indicators in the UI while waiting for a response.
    *   Show user-friendly error messages if an API call fails.

---

### Milestone 3: Feature Parity with CLI

*(Goal: Integrate key features from the CLI, such as configuration and tool usage.)*

*   **Task 1: Settings Management**
    *   Create a dedicated "Settings" page in the UI.
    *   Allow users to configure their Gemini API Key and other authentication methods, mirroring the CLI's auth flow.
    *   Expose key settings from `settings.json` (e.g., model selection, telemetry options) in the UI.

*   **Task 2: Interactive Tool Approval (Read-Only)**
    *   Implement UI components to display tool call requests from the model.
    *   Add "Approve" / "Deny" buttons for the user to interact with.

*   **Task 3: Context Awareness**
    *   Integrate the file discovery service from `@google/gemini-cli-core`.
    *   Provide a UI element that shows which files are currently included in the context.

---

### Milestone 4: Packaging & Distribution

*(Goal: Prepare the application for release.)*

*   **Task 1: Application Icon & Branding**
    *   Design and add an application icon.

*   **Task 2: Build & Packaging Automation**
    *   Configure Electron Forge/Builder to create distributable packages for major operating systems (macOS `.dmg`, Windows `.exe`, Linux `.AppImage` or `.deb`).
    *   Integrate this build process into the project's existing CI/CD pipeline.
