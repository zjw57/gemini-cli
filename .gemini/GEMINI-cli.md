# packages/cli

## File Tree

```
packages/cli/
├── dist/
│   ├── index.d.ts
│   ├── index.js
│   ├── index.js.map
│   ├── package.json
│   ├── src/
│   │   ├── config/
│   │   │   ├── auth.d.ts
│   │   │   ├── auth.js
│   │   │   ├── auth.js.map
│   │   │   ├── config.d.ts
│   │   │   ├── config.js
│   │   │   ├── config.js.map
│   │   │   ├── extension.d.ts
│   │   │   ├── extension.js
│   │   │   ├── extension.js.map
│   │   │   ├── sandboxConfig.d.ts
│   │   │   ├── sandboxConfig.js
│   │   │   ├── sandboxConfig.js.map
│   │   │   ├── settings.d.ts
│   │   │   ├── settings.js
│   │   │   └── settings.js.map
│   │   ├── gemini.d.ts
│   │   ├── gemini.js
│   │   ├── gemini.js.map
│   │   ├── gemini.test.d.ts
│   │   ├── gemini.test.js
│   │   ├── gemini.test.js.map
│   │   ├── generated/
│   │   │   ├── git-commit.d.ts
│   │   �����   ├── git-commit.js
│   │   │   └── git-commit.js.map
│   │   ├── nonInteractiveCli.d.ts
│   │   ├── nonInteractiveCli.js
│   │   ├── nonInteractiveCli.js.map
│   │   ├── ui/
│   │   │   ├── App.d.ts
│   │   │   ├── App.js
│   │   │   ├── App.js.map
│   │   │   ├── App.test.d.ts
│   │   │   ├── App.test.js
│   │   │   ├── App.test.js.map
│   │   │   ├── colors.d.ts
│   │   │   ├── colors.js
│   │   │   ├── colors.js.map
│   │   │   ├── components/
│   │   │   ├── constants.d.ts
│   │   │   ├── constants.js
│   │   │   ├── constants.js.map
│   │   │   ├── contexts/
│   │   │   ├── editors/
│   │   │   ├── hooks/
│   │   │   ├── privacy/
│   │   │   ├── themes/
│   │   │   ├── types.d.ts
│   │   │   ├── types.js
│   │   │   ├── types.js.map
│   │   │   └── utils/
│   │   └── utils/
│   └── tsconfig.tsbuildinfo
├── index.ts
├── junit.xml
├── package.json
├── src/
│   ├── config/
│   │   ├── auth.ts
│   │   ├── config.integration.test.ts
│   │   ├── config.test.ts
│   │   ├── config.ts
│   │   ├── extension.test.ts
│   │   ├── extension.ts
│   │   ├── sandboxConfig.ts
│   │   ├── settings.test.ts
│   │   └── settings.ts
│   ├── gemini.test.tsx
│   ├── gemini.tsx
│   ├── generated/
│   │   └── git-commit.ts
│   ├── nonInteractiveCli.test.ts
│   ├── nonInteractiveCli.ts
│   ├── ui/
│   │   ├── App.test.tsx
│   │   ├── App.tsx
│   │   ├── colors.ts
│   │   ├── components/
│   │   │   ├── __snapshots__/
│   │   │   ├── AboutBox.tsx
│   │   │   ├── AsciiArt.ts
│   │   │   ├── AuthDialog.test.tsx
│   │   │   ├── AuthDialog.tsx
│   │   │   ├── AuthInProgress.tsx
│   │   │   ├── AutoAcceptIndicator.tsx
│   │   │   ├── ConsolePatcher.tsx
│   │   │   ├── ConsoleSummaryDisplay.tsx
│   │   │   ├── ContextSummaryDisplay.tsx
│   │   │   ├── DetailedMessagesDisplay.tsx
│   │   │   ├── EditorSettingsDialog.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── GeminiRespondingSpinner.tsx
│   │   │   ├── Header.tsx
│   │   │   ├��─ Help.tsx
│   │   │   ├── HistoryItemDisplay.test.tsx
│   │   │   ├── HistoryItemDisplay.tsx
│   │   │   ├── InputPrompt.test.tsx
│   │   │   ├── InputPrompt.tsx
│   │   │   ├── LoadingIndicator.test.tsx
│   │   │   ├── LoadingIndicator.tsx
│   │   │   ├── MemoryUsageDisplay.tsx
│   │   │   ├── messages/
│   │   │   ├── ModelStatsDisplay.test.tsx
│   │   │   ├── ModelStatsDisplay.tsx
│   │   │   ├── SessionSummaryDisplay.test.tsx
│   │   │   ├── SessionSummaryDisplay.tsx
│   │   │   ├── shared/
│   │   │   ├── ShellModeIndicator.tsx
│   │   │   ├── ShowMoreLines.tsx
│   │   │   ├── StatsDisplay.test.tsx
│   │   │   ├── StatsDisplay.tsx
│   │   │   ├── SuggestionsDisplay.tsx
│   │   │   ├── ThemeDialog.tsx
│   │   │   ├── Tips.tsx
│   │   │   ├── ToolStatsDisplay.test.tsx
│   │   │   ├── ToolStatsDisplay.tsx
│   │   │   └── UpdateNotification.tsx
│   │   ├── constants.ts
│   │   ├── contexts/
│   │   │   ├── OverflowContext.tsx
│   │   │   ├── SessionContext.test.tsx
│   │   │   ├── SessionContext.tsx
│   │   │   └── StreamingContext.tsx
│   │   ├── editors/
│   │   │   └── editorSettingsManager.ts
│   │   ├── hooks/
│   │   │   ├── atCommandProcessor.test.ts
│   │   │   ├── atCommandProcessor.ts
│   │   │   ├── shellCommandProcessor.test.ts
│   │   │   ├── shellCommandProcessor.ts
│   │   │   ├── slashCommandProcessor.test.ts
│   │   │   ├── slashCommandProcessor.ts
│   │   │   ├── useAuthCommand.ts
│   │   │   ├── useAutoAcceptIndicator.test.ts
│   │   │   ├── useAutoAcceptIndicator.ts
│   │   │   ├── useBracketedPaste.ts
│   │   │   ├── useCompletion.integration.test.ts
│   │   │   ├── useCompletion.ts
│   │   │   ├── useConsoleMessages.test.ts
│   │   │   ├── useConsoleMessages.ts
│   │   │   ├── useEditorSettings.test.ts
│   │   │   ├── useEditorSettings.ts
│   │   │   ├── useGeminiStream.test.tsx
│   │   │   ├── useGeminiStream.ts
│   │   │   ├── useGitBranchName.test.ts
│   │   │   ├── useGitBranchName.ts
│   │   │   ├── useHistoryManager.test.ts
│   │   │   ├── useHistoryManager.ts
│   │   │   ├── useInputHistory.test.ts
│   │   │   ├── useInputHistory.ts
│   │   │   ├── useKeypress.ts
│   │   │   ├── useLoadingIndicator.test.ts
│   │   │   ├── useLoadingIndicator.ts
│   │   │   ├── useLogger.ts
│   │   │   ├── usePhraseCycler.test.ts
│   │   │   ├── usePhraseCycler.ts
│   │   │   ├── usePrivacySettings.ts
│   │   │   ├── useReactToolScheduler.ts
│   │   │   ├── useRefreshMemoryCommand.ts
│   │   │   ├── useShellHistory.test.ts
│   │   │   ├── useShellHistory.ts
│   │   │   ├── useShowMemoryCommand.ts
│   │   │   ├── useStateAndRef.ts
│   │   │   ├── useTerminalSize.ts
│   │   │   ├── useThemeCommand.ts
│   │   │   ├── useTimer.test.ts
│   │   │   ├── useTimer.ts
│   │   │   └── useToolScheduler.test.ts
│   │   ├── privacy/
│   │   │   ├── CloudFreePrivacyNotice.tsx
│   │   │   ├── CloudPaidPrivacyNotice.tsx
│   │   │   ├── GeminiPrivacyNotice.tsx
│   │   │   └── PrivacyNotice.tsx
│   │   ├── themes/
│   │   │   ├── ansi-light.ts
│   │   │   ├── ansi.ts
│   │   │   ├── atom-one-dark.ts
│   │   ��   ├── ayu-light.ts
│   │   │   ├── ayu.ts
│   │   │   ├── default-light.ts
│   │   │   ├── default.ts
│   │   │   ├── dracula.ts
│   │   │   ├── github-dark.ts
│   │   │   ├── github-light.ts
│   │   │   ├── googlecode.ts
│   │   │   ├── no-color.ts
│   │   │   ├── shades-of-purple.ts
│   │   │   ├── theme-manager.ts
│   │   │   ├── theme.ts
│   │   │   └── xcode.ts
│   │   ├── types.ts
│   │   └── utils/
│   │       ├── CodeColorizer.tsx
│   │       ├── commandUtils.ts
│   │       ├── computeStats.test.ts
│   │       ├── computeStats.ts
│   │       ├── displayUtils.test.ts
│   │       ├── displayUtils.ts
│   │       ├── errorParsing.test.ts
│   │       ├── errorParsing.ts
│   │       ├── formatters.test.ts
│   │       ├── formatters.ts
│   │       ├── MarkdownDisplay.test.tsx
│   │       ├── MarkdownDisplay.tsx
│   │       ├── markdownUtilities.test.ts
│   │       ├── markdownUtilities.ts
│   │       ├── TableRenderer.tsx
│   │       ├── textUtils.test.ts
│   │       ├── textUtils.ts
│   │       ├── updateCheck.test.ts
│   │       └── updateCheck.ts
│   └── utils/
│       ├── cleanup.ts
│       ├── package.ts
│       ├── readStdin.ts
│       ├── sandbox-macos-permissive-closed.sb
│       ├── sandbox-macos-permissive-open.sb
│       ├── sandbox-macos-permissive-proxied.sb
│       ├── sandbox-macos-restrictive-closed.sb
│       ├── sandbox-macos-restrictive-open.sb
│       ├── sandbox-macos-restrictive-proxied.sb
│       ├── sandbox.ts
│       ├── startupWarnings.test.ts
│       ├── startupWarnings.ts
│       ├── userStartupWarnings.test.ts
│       ├── userStartupWarnings.ts
│       └── version.ts
├── tsconfig.json
└── vitest.config.ts
```

## File Summaries

### `packages/cli/src/config/auth.ts`

This file manages authentication by retrieving, caching, and refreshing access tokens for Google AI services. It defines functions to get an `GoogleAuth` client, which can be used to make authenticated requests.

### `packages/cli/src/config/config.ts`

This file is responsible for loading and merging configuration from multiple sources, including user-specific settings, project-specific settings, and command-line arguments. It defines the `loadConfig` function, which provides a unified configuration object for the application.

### `packages/cli/src/config/extension.ts`

This file handles the loading and management of extensions for the Gemini CLI. It defines functions to discover, load, and validate extensions, allowing for the addition of custom tools and commands.

### `packages/cli/src/config/sandboxConfig.ts`

This file defines the configuration for the sandbox environment in which the Gemini CLI can execute code. It includes settings for the sandbox implementation (e.g., Docker, Podman), as well as resource limits and networking rules.

### `packages/cli/src/config/settings.ts`

This file provides a structured way to access and manage user settings. It defines the `Settings` class, which loads settings from a JSON file and provides methods for getting and setting configuration values.

### `packages/cli/src/gemini.tsx`

This is the main entry point for the interactive Gemini CLI. It uses the `ink` library to render the user interface and orchestrates the various components that make up the application.

### `packages/cli/src/nonInteractiveCli.ts`

This file provides a non-interactive mode for the Gemini CLI, allowing it to be used in scripts and other automated workflows. It processes a single query and prints the result to standard output.

### `packages/cli/src/ui/App.tsx`

This file defines the root component of the Gemini CLI's user interface. It sets up the main layout and renders the various sub-components, such as the header, footer, and message display areas.

### `packages/cli/src/ui/colors.ts`

This file defines the color palette used throughout the Gemini CLI's user interface. It exports a set of named colors that can be used to ensure a consistent look and feel.

### `packages/cli/src/ui/components/AboutBox.tsx`

This file defines a React component that displays information about the Gemini CLI, such as the version number and a link to the project's website.

### `packages/cli/src/ui/components/AsciiArt.ts`

This file contains ASCII art used in the Gemini CLI's user interface, such as the logo displayed on startup.

### `packages/cli/src/ui/components/AuthDialog.tsx`

This file defines a React component that prompts the user to authenticate with their Google account. It provides instructions and a link to the authentication page.

### `packages/cli/src/ui/components/AuthInProgress.tsx`

This file defines a React component that is displayed while the authentication process is in progress. It shows a loading indicator and a message to the user.

### `packages/cli/src/ui/components/AutoAcceptIndicator.tsx`

This file defines a React component that indicates whether the auto-accept feature is enabled. This feature allows the CLI to automatically execute tool calls without prompting the user for confirmation.

### `packages/cli/src/ui/components/ConsolePatcher.tsx`

This file defines a React component that patches the global `console` object to intercept and display log messages within the Gemini CLI's user interface.

### `packages/cli/src/ui/components/ConsoleSummaryDisplay.tsx`

This file defines a React component that displays a summary of the messages that have been logged to the console.

### `packages/cli/src/ui/components/ContextSummaryDisplay.tsx`

This file defines a React component that displays a summary of the current context, including the active files and tools.

### `packages/cli/src/ui/components/DetailedMessagesDisplay.tsx`

This file defines a React component that displays a detailed view of the messages in the current session, including the full content of each message.

### `packages/cli/src/ui/components/EditorSettingsDialog.tsx`

This file defines a React component that allows the user to configure their preferred editor and other editor-related settings.

### `packages/cli/src/ui/components/Footer.tsx`

This file defines the footer component of the Gemini CLI's user interface. It displays information such as the current version and a link to the help documentation.

### `packages/cli/src/ui/components/GeminiRespondingSpinner.tsx`

This file defines a React component that displays a spinner while Gemini is processing a request.

### `packages/cli/src/ui/components/Header.tsx`

This file defines the header component of the Gemini CLI's user interface. It displays the Gemini logo and the title of the application.

### `packages/cli/src/ui/components/Help.tsx`

This file defines a React component that displays help information for the Gemini CLI, including a list of available commands and their descriptions.

### `packages/cli/src/ui/components/HistoryItemDisplay.tsx`

This file defines a React component that displays a single item from the command history.

### `packages/cli/src/ui/components/InputPrompt.tsx`

This file defines the input prompt component of the Gemini CLI's user interface. It allows the user to enter commands and queries.

### `packages/cli/src/ui/components/LoadingIndicator.tsx`

This file defines a React component that displays a loading indicator.

### `packages/cli/src/ui/components/MemoryUsageDisplay.tsx`

This file defines a React component that displays the current memory usage of the Gemini CLI.

### `packages/cli/src/ui/components/messages/CompressionMessage.tsx`

This file defines a React component that displays a message indicating that the context has been compressed.

### `packages/cli/src/ui/components/messages/DiffRenderer.tsx`

This file defines a React component that renders a diff between two strings.

### `packages/cli/src/ui/components/messages/ErrorMessage.tsx`

This file defines a React component that displays an error message.

### `packages/cli/src/ui/components/messages/GeminiMessage.tsx`

This file defines a React component that displays a message from Gemini.

### `packages/cli/src/ui/components/messages/GeminiMessageContent.tsx`

This file defines a React component that displays the content of a message from Gemini.

### `packages/cli/src/ui/components/messages/InfoMessage.tsx`

This file defines a React component that displays an informational message.

### `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`

This file defines a React component that prompts the user to confirm the execution of a tool.

### `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`

This file defines a React component that displays a group of tool-related messages.

### `packages/cli/src/ui/components/messages/ToolMessage.tsx`

This file defines a React component that displays a message related to a tool.

### `packages/cli/src/ui/components/messages/UserMessage.tsx`

This file defines a React component that displays a message from the user.

### `packages/cli/src/ui/components/messages/UserShellMessage.tsx`

This file defines a React component that displays a shell command entered by the user.

### `packages/cli/src/ui/components/ModelStatsDisplay.tsx`

This file defines a React component that displays statistics about the model, such as the number of tokens used.

### `packages/cli/src/ui/components/SessionSummaryDisplay.tsx`

This file defines a React component that displays a summary of the current session, including the number of messages and tool calls.

### `packages/cli/src/ui/components/shared/MaxSizedBox.tsx`

This file defines a React component that limits the size of its children to a maximum width and height.

### `packages/cli/src/ui/components/shared/RadioButtonSelect.tsx`

This file defines a React component that displays a list of radio buttons, allowing the user to select one option from a set.

### `packages/cli/src/ui/components/shared/text-buffer.ts`

This file defines a class that provides a buffer for storing and manipulating text.

### `packages/cli/src/ui/components/ShellModeIndicator.tsx`

This file defines a React component that indicates whether shell mode is enabled.

### `packages/cli/src/ui/components/ShowMoreLines.tsx`

This file defines a React component that allows the user to expand a collapsed section of text to show more lines.

### `packages/cli/src/ui/components/StatsDisplay.tsx`

This file defines a React component that displays various statistics about the current session.

### `packages/cli/src/ui/components/SuggestionsDisplay.tsx`

This file defines a React component that displays a list of suggested commands and queries.

### `packages/cli/src/ui/components/ThemeDialog.tsx`

This file defines a React component that allows the user to select a theme for the Gemini CLI's user interface.

### `packages/cli/src/ui/components/Tips.tsx`

This file defines a React component that displays a random tip to the user.

### `packages/cli/src/ui/components/ToolStatsDisplay.tsx`

This file defines a React component that displays statistics about the tools that have been used in the current session.

### `packages/cli/src/ui/components/UpdateNotification.tsx`

This file defines a React component that notifies the user when an update to the Gemini CLI is available.

### `packages/cli/src/ui/constants.ts`

This file defines a set of constants used throughout the Gemini CLI's user interface.

### `packages/cli/src/ui/contexts/OverflowContext.tsx`

This file defines a React context that provides information about whether the content of a component is overflowing its container.

### `packages/cli/src/ui/contexts/SessionContext.tsx`

This file defines a React context that provides access to the current session state, including the list of messages and tool calls.

### `packages/cli/src/ui/contexts/StreamingContext.tsx`

This file defines a React context that provides information about whether a response from Gemini is currently streaming.

### `packages/cli/src/ui/editors/editorSettingsManager.ts`

This file defines a class that manages the user's editor settings, including their preferred editor and other related options.

### `packages/cli/src/ui/hooks/atCommandProcessor.ts`

This file defines a hook that processes `@` commands, which are used to reference files and tools.

### `packages/cli/src/ui/hooks/shellCommandProcessor.ts`

This file defines a hook that processes shell commands entered by the user.

### `packages/cli/src/ui/hooks/slashCommandProcessor.ts`

This file defines a hook that processes slash commands, which are used to perform various actions within the Gemini CLI.

### `packages/cli/src/ui/hooks/useAuthCommand.ts`

This file defines a hook that provides the logic for the `/auth` command, which is used to authenticate the user with their Google account.

### `packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts`

This file defines a hook that provides the logic for the auto-accept indicator, which shows whether the CLI will automatically execute tool calls.

### `packages/cli/src/ui/hooks/useBracketedPaste.ts`

This file defines a hook that enables bracketed paste mode in the terminal, which allows for the safe pasting of multi-line text.

### `packages/cli/src/ui/hooks/useCompletion.ts`

This file defines a hook that provides autocompletion for commands and queries.

### `packages/cli/src/ui/hooks/useConsoleMessages.ts`

This file defines a hook that provides access to the messages that have been logged to the console.

### `packages/cli/src/ui/hooks/useEditorSettings.ts`

This file defines a hook that provides access to the user's editor settings.

### `packages/cli/src/ui/hooks/useGeminiStream.ts`

This file defines a hook that handles the streaming of responses from Gemini.

### `packages/cli/src/ui/hooks/useGitBranchName.ts`

This file defines a hook that provides the name of the current Git branch.

### `packages/cli/src/ui/hooks/useHistoryManager.ts`

This file defines a hook that manages the command history.

### `packages/cli/src/ui/hooks/useInputHistory.ts`

This file defines a hook that provides access to the user's input history.

### `packages/cli/src/ui/hooks/useKeypress.ts`

This file defines a hook that handles key presses from the user.

### `packages/cli/src/ui/hooks/useLoadingIndicator.ts`

This file defines a hook that provides the logic for the loading indicator.

### `packages/cli/src/ui/hooks/useLogger.ts`

This file defines a hook that provides a logging function that can be used to log messages to the console.

### `packages/cli/src/ui/hooks/usePhraseCycler.ts`

This file defines a hook that cycles through a list of phrases.

### `packages/cli/src/ui/hooks/usePrivacySettings.ts`

This file defines a hook that provides access to the user's privacy settings.

### `packages/cli/src/ui/hooks/useReactToolScheduler.ts`

This file defines a hook that schedules the execution of React-based tools.

### `packages/cli/src/ui/hooks/useRefreshMemoryCommand.ts`

This file defines a hook that provides the logic for the `/refresh-memory` command, which is used to refresh the tool's memory of the current context.

### `packages/cli/src/ui/hooks/useShellHistory.ts`

This file defines a hook that provides access to the user's shell command history.

### `packages/cli/src/ui/hooks/useShowMemoryCommand.ts`

This file defines a hook that provides the logic for the `/show-memory` command, which is used to display the tool's memory of the current context.

### `packages/cli/src/ui/hooks/useStateAndRef.ts`

This file defines a hook that combines the functionality of `useState` and `useRef`, providing a way to store a value that can be updated without triggering a re-render.

### `packages/cli/src/ui/hooks/useTerminalSize.ts`

This file defines a hook that provides the current size of the terminal.

### `packages/cli/src/ui/hooks/useThemeCommand.ts`

This file defines a hook that provides the logic for the `/theme` command, which is used to change the theme of the Gemini CLI's user interface.

### `packages/cli/src/ui/hooks/useTimer.ts`

This file defines a hook that provides a timer that can be used to schedule the execution of a function after a specified delay.

### `packages/cli/src/ui/privacy/CloudFreePrivacyNotice.tsx`

This file defines a React component that displays a privacy notice for users of the free version of Google Cloud.

### `packages/cli/src/ui/privacy/CloudPaidPrivacyNotice.tsx`

This file defines a React component that displays a privacy notice for users of the paid version of Google Cloud.

### `packages/cli/src/ui/privacy/GeminiPrivacyNotice.tsx`

This file defines a React component that displays a privacy notice for users of Gemini.

### `packages/cli/src/ui/privacy/PrivacyNotice.tsx`

This file defines a React component that displays a general privacy notice.

### `packages/cli/src/ui/themes/ansi-light.ts`

This file defines a light theme that uses ANSI escape codes to color the user interface.

### `packages/cli/src/ui/themes/ansi.ts`

This file defines a theme that uses ANSI escape codes to color the user interface.

### `packages/cli/src/ui/themes/atom-one-dark.ts`

This file defines a dark theme based on the Atom One Dark color scheme.

### `packages/cli/src/ui/themes/ayu-light.ts`

This file defines a light theme based on the Ayu Light color scheme.

### `packages/cli/src/ui/themes/ayu.ts`

This file defines a theme based on the Ayu color scheme.

### `packages/cli/src/ui/themes/default-light.ts`

This file defines the default light theme for the Gemini CLI.

### `packages/cli/src/ui/themes/default.ts`

This file defines the default theme for the Gemini CLI.

### `packages/cli/src/ui/themes/dracula.ts`

This file defines a theme based on the Dracula color scheme.

### `packages/cli/src/ui/themes/github-dark.ts`

This file defines a dark theme based on the GitHub Dark color scheme.

### `packages/cli/src/ui/themes/github-light.ts`

This file defines a light theme based on the GitHub Light color scheme.

### `packages/cli/src/ui/themes/googlecode.ts`

This file defines a theme based on the Google Code color scheme.

### `packages/cli/src/ui/themes/no-color.ts`

This file defines a theme that does not use any colors.

### `packages/cli/src/ui/themes/shades-of-purple.ts`

This file defines a theme based on the Shades of Purple color scheme.

### `packages/cli/src/ui/themes/theme-manager.ts`

This file defines a class that manages the themes for the Gemini CLI.

### `packages/cli/src/ui/themes/theme.ts`

This file defines the interface for a theme.

### `packages/cli/src/ui/themes/xcode.ts`

This file defines a theme based on the Xcode color scheme.

### `packages/cli/src/ui/types.ts`

This file defines the types used throughout the Gemini CLI's user interface.

### `packages/cli/src/ui/utils/CodeColorizer.tsx`

This file defines a React component that colorizes code using a specified theme.

### `packages/cli/src/ui/utils/commandUtils.ts`

This file provides utility functions for working with commands.

### `packages/cli/src/ui/utils/computeStats.ts`

This file provides utility functions for computing statistics about the current session.

### `packages/cli/src/ui/utils/displayUtils.ts`

This file provides utility functions for displaying information in the user interface.

### `packages/cli/src/ui/utils/errorParsing.ts`

This file provides utility functions for parsing and displaying error messages.

### `packages/cli/src/ui/utils/formatters.ts`

This file provides utility functions for formatting text.

### `packages/cli/src/ui/utils/MarkdownDisplay.tsx`

This file defines a React component that renders Markdown text.

### `packages/cli/src/ui/utils/markdownUtilities.ts`

This file provides utility functions for working with Markdown text.

### `packages/cli/src/ui/utils/TableRenderer.tsx`

This file defines a React component that renders a table.

### `packages/cli/src/ui/utils/textUtils.ts`

This file provides utility functions for working with text.

### `packages/cli/src/ui/utils/updateCheck.ts`

This file provides a function to check for updates to the Gemini CLI.

### `packages/cli/src/utils/cleanup.ts`

This file provides a function to clean up resources when the Gemini CLI exits.

### `packages/cli/src/utils/package.ts`

This file provides information about the `package.json` file.

### `packages/cli/src/utils/readStdin.ts`

This file provides a function to read from standard input.

### `packages/cli/src/utils/sandbox.ts`

This file provides functions for working with the sandbox environment.

### `packages/cli/src/utils/startupWarnings.ts`

This file provides a function to display warnings on startup.

### `packages/cli/src/utils/userStartupWarnings.ts`

This file provides a function to display user-specific warnings on startup.

### `packages/cli/src/utils/version.ts`

This file provides the version of the Gemini CLI.
