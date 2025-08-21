/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolInvocation,
  ToolResult,
} from './tools.js';
import { LSTool } from './ls.js';
import { EditTool } from './edit.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ReadFileTool } from './read-file.js';
import { ReadManyFilesTool } from './read-many-files.js';
import { ShellTool } from './shell.js';
import { WriteFileTool } from './write-file.js';
import { MemoryTool } from './memoryTool.js';

// Define the order in which tools should be presented in the prompt.
// We only list the primary tool for grouped entries.
export const ORDERED_TOOL_INFO_KEYS = [
  LSTool.Name,
  GlobTool.Name,
  GrepTool.Name,
  ReadFileTool.Name,
  ReadManyFilesTool.Name,
  EditTool.Name,
  WriteFileTool.Name,
  ShellTool.Name,
  MemoryTool.Name,
];

/**
 * Parameters for the GetToolInfoParams
 */
export interface GetToolInfoParams {
  tool_name: string;
}

class GetToolInfoToolInvocation extends BaseToolInvocation<
  GetToolInfoParams,
  ToolResult
> {
  constructor(params: GetToolInfoParams) {
    super(params);
  }

  getDescription(): string {
    return `Get information about the ${this.params.tool_name} tool.`;
  }

  async execute(
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const toolName = this.params.tool_name;
    const content =
      TOOL_INFO[toolName] ||
      `Error: Documentation not found for tool "${toolName}". Please ensure the tool name is correct.`;
    return {
      llmContent: [{ text: content }],
      returnDisplay: '',
      summary: `Displayed documentation for ${toolName}`,
    };
  }
}

export class GetToolInfoTool extends BaseDeclarativeTool<
  GetToolInfoParams,
  ToolResult
> {
  static Name: string = 'get_tool_info';

  // Renamed config to _config to satisfy unused variable lint rules
  constructor() {
    super(
      GetToolInfoTool.Name,
      'Get Tool Info',
      'Provides detailed documentation for a given tool.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          tool_name: {
            type: 'string',
            description: 'The name of the tool to get information about.',
          },
        },
        required: ['tool_name'],
      },
      true, // output is markdown
      false, // output cannot be updated
    );
  }

  protected createInvocation(
    params: GetToolInfoParams,
  ): ToolInvocation<GetToolInfoParams, ToolResult> {
    return new GetToolInfoToolInvocation(params);
  }
}

/**
 * Centralized repository for tool-specific usage instructions and examples.
 * This data is intended to be returned by the ToolInfoTool (getToolInfo).
 */
const TOOL_INFO: Record<string, string> = {
  [LSTool.Name]: `
# Tool: ${LSTool.Name} (List Directory Contents)

## Description
Use this tool to explore the immediate contents of a specific directory. It returns a list of files and subdirectories within the given path.

## Parameters
- \`path\` (string, required): The absolute path to the directory to list (must be absolute, not relative).
- \`ignore\` (array of strings, optional): List of glob patterns to ignore.
- \`file_filtering_options\` (object, optional): Optional: Whether to respect ignore patterns from .gitignore or .geminiignore.
    - \`respect_git_ignore\` (boolean, optional): Optional: Whether to respect .gitignore patterns when listing files. Only available in git repositories. Defaults to true.
    - \`respect_gemini_ignore\` (boolean, optional): Optional: Whether to respect .geminiignore patterns when listing files. Defaults to true.

## Guidelines
- **Absolute Paths MANDATORY:** You MUST provide an absolute path. Relative paths (like '.') will fail.
- **Non-Recursive:** This tool only lists the immediate children of the directory. Use '${GlobTool.Name}' for recursive searches or pattern matching.

## Examples
<example>
user: list files here.
model: [tool_call: ${LSTool.Name} for path '/path/to/project']
</example>

<example>
user: What's in the src/utils folder?
model:
I need the absolute path for src/utils.
[tool_call: ${LSTool.Name} for path '/path/to/project/src/utils']
</example>
`.trim(),

  [GlobTool.Name]: `
# Tool: ${GlobTool.Name} (Find Files by Pattern)

## Description
Use this tool to search for files matching specific patterns (globs) starting from the project root directory. This is crucial for discovering file locations, understanding project structure, and finding related files.

## Parameters
- \`pattern\` (string, required): The glob pattern to match against (e.g., '**/*.py', 'docs/*.md').
- \`path\` (string, optional): The absolute path to the directory to search within. If omitted, searches the root directory.
- \`case_sensitive\` (boolean, optional): Whether the search should be case-sensitive. Defaults to false.
- \`respect_git_ignore\` (boolean, optional): Whether to respect .gitignore patterns when finding files. Only available in git repositories. Defaults to true.

## Guidelines
- **Relative to Root:** The pattern is applied relative to the project's root directory. You do not need the full absolute path here, just the pattern within the project.
- **Glob Syntax:**
    - Use \`*\` to match any characters within a single directory or filename segment.
    - Use \`**\` to match zero or more directories/subdirectories (recursive search).
- **Strategy:** Start with broad patterns (e.g., 'src/**/*') to understand the structure, then narrow them down (e.g., 'src/utils/*.js').
- Use this extensively to find relevant files (tests, configs) before attempting modifications.

## Examples
<example>
user: Where are all the 'app.config' files in this project?
model:
I will search recursively across the entire project.
[tool_call: ${GlobTool.Name} for pattern '**/app.config']
</example>
<example>
user: Find all typescript files in the src directory.
model:
I will search recursively within the 'src' directory for '.ts' files.
[tool_call: ${GlobTool.Name} for pattern 'src/**/*.ts']
</example>
<example>
user: Are there any test files for the authentication service?
model:
I will look for common test file patterns related to 'auth'.
[tool_call: ${GlobTool.Name} for pattern '**/*auth*.test.*']
[tool_call: ${GlobTool.Name} for pattern '**/*auth*.spec.*']
</example>
`.trim(),

  [GrepTool.Name]: `
# Tool: ${GrepTool.Name} (Search File Contents)

## Description
Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers.

## Parameters
- \`pattern\` (string, required): The regular expression (regex) pattern to search for within file contents (e.g., 'function\s+myFunction', 'import\s+\{.*\}\s+from\s+.*').
- \`path\` (string, optional): The absolute path to the directory to search within. If omitted, searches the current working directory.
- \`include\` (string, optional): A glob pattern to filter which files are searched (e.g., '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files (respecting potential global ignores).

## Guidelines
- **Scope:** This tool searches the entire project directory.
- **Usage Analysis:** Essential for dependency tracing and impact analysis. Use it to understand how functions, classes, variables, or API endpoints are utilized across the codebase.
- **Exploration:** Use this extensively during the initial "Understand" phase of any task.
- **Regex Power:** Leverage regular expressions for complex searches. Combine multiple related terms using the OR operator '|' (e.g., 'UserProfile|updateProfile|editUser') to maximize relevant results in a single search.

## Examples
<example>
user: How is the 'authenticateUser' function used in this project?
model:
I will search the codebase for usages of 'authenticateUser'.
[tool_call: ${GrepTool.Name} for pattern 'authenticateUser']
</example>
<example>
user: I need to find where we configure the database connection string.
model:
I will search for common terms related to database configuration using a combined regex pattern.
[tool_call: ${GrepTool.Name} for pattern 'DB_CONNECTION|DATABASE_URL|connectionString']
</example>
<example>
user: Find all imports of the 'lodash' library.
model:
I will search for import/require statements involving 'lodash' using regex.
[tool_call: ${GrepTool.Name} for pattern "(import.*from 'lodash'|require\('lodash'\))"]
</example>
`.trim(),

  [ReadFileTool.Name]: `
# Tool: ${ReadFileTool.Name} (Read File Content)

## Description
Reads and returns the content of a specified file. If the file is large, the content will be truncated. The tool's response will clearly indicate if truncation has occurred and will provide details on how to read more of the file using the 'offset' and 'limit' parameters. Handles text, images (PNG, JPG, GIF, WEBP, SVG, BMP), and PDF files. For text files, it can read specific line ranges.

## Parameters
- \`absolute_path\` (string, required): The absolute path to the file to read (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path.
- \`offset\` (number, optional): Optional: For text files, the 0-based line number to start reading from. Requires 'limit' to be set. Use for paginating through large files.
- \`limit\` (number, optional): Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. If omitted, reads the entire file (if feasible, up to a default limit).

## Guidelines
- **Absolute Paths MANDATORY:** You MUST provide the full absolute path.
- **Verify Before Modifying (CRUCIAL):** NEVER attempt to use '${EditTool.Name}' or '${WriteFileTool.Name}' without first reading the file. You must understand the existing code structure, style, context, and line numbers before making changes.
- **Configuration Checks:** Use this to verify dependencies (e.g., reading 'package.json', 'requirements.txt') or check build scripts.
- **Efficiency:** If you need to read more than one file, use '${ReadManyFilesTool.Name}' instead.

## Examples
<example>
user: Check if 'axios' is a dependency in package.json.
model:
I will read the package.json file to verify dependencies.
[tool_call: ${ReadFileTool.Name} for absolute_path '/path/to/project/package.json']
</example>
<example>
user: Refactor the 'getUserData' function in src/user.js.
model:
Before I can refactor, I must first read the file to understand its contents, structure, and line numbers.
[tool_call: ${ReadFileTool.Name} for absolute_path '/path/to/project/src/user.js']
</example>
`.trim(),

  [ReadManyFilesTool.Name]: `
# Tool: ${ReadManyFilesTool.Name} (Read Multiple Files Content)

## Description
Reads content from multiple files specified by paths or glob patterns within a configured target directory. For text files, it concatenates their content into a single string. It is primarily designed for text-based files. However, it can also process image (e.g., .png, .jpg) and PDF (.pdf) files if their file names or extensions are explicitly included in the 'paths' argument. For these explicitly requested non-text files, their data is read and included in a format suitable for model consumption (e.g., base64 encoded).

This tool is useful when you need to understand or analyze a collection of files, such as:
- Getting an overview of a codebase or parts of it (e.g., all TypeScript files in the 'src' directory).
- Finding where specific functionality is implemented if the user asks broad questions about code.
- Reviewing documentation files (e.g., all Markdown files in the 'docs' directory).
- Gathering context from multiple configuration files.
- When the user asks to "read all files in X directory" or "show me the content of all Y files".

Use this tool when the user's query implies needing the content of several files simultaneously for context, analysis, or summarization. For text files, it uses default UTF-8 encoding and a '--- {filePath} ---' separator between file contents. Ensure paths are relative to the target directory. Glob patterns like 'src/**/*.js' are supported. Avoid using for single files if a more specific single-file reading tool is available, unless the user specifically requests to process a list containing just one file via this tool. Other binary files (not explicitly requested as image/PDF) are generally skipped. Default excludes apply to common non-text files (except for explicitly requested images/PDFs) and large dependency directories unless 'useDefaultExcludes' is false.

## Parameters
- \`paths\` (array of strings, required): Required. An array of glob patterns or paths relative to the tool's target directory. Examples: ['src/**/*.ts'], ['README.md', 'docs/'].
- \`include\` (array of strings, optional): Optional. Additional glob patterns to include. These are merged with \`paths\`. Example: "*.test.ts" to specifically add test files if they were broadly excluded.
- \`exclude\` (array of strings, optional): Optional. Glob patterns for files/directories to exclude. Added to default excludes if useDefaultExcludes is true. Example: "**/*.log", "temp/".
- \`recursive\` (boolean, optional): Optional. Whether to search recursively (primarily controlled by \`**\` in glob patterns). Defaults to true.
- \`useDefaultExcludes\` (boolean, optional): Optional. Whether to apply a list of default exclusion patterns (e.g., node_modules, .git, binary files). Defaults to true.
- \`file_filtering_options\` (object, optional): Whether to respect ignore patterns from .gitignore or .geminiignore.
    - \`respect_git_ignore\` (boolean, optional): Optional: Whether to respect .gitignore patterns when listing files. Only available in git repositories. Defaults to true.
    - \`respect_gemini_ignore\` (boolean, optional): Optional: Whether to respect .geminiignore patterns when listing files. Defaults to true.

## Guidelines
- **Relative Paths:** All paths and patterns are relative to the project's root directory.
- **Contextual Understanding:** This is the preferred method when you need to understand how multiple files interact (e.g., a component and its stylesheet, an implementation file and its test file).
- **Verify Before Modifying (CRUCIAL):** As with '${ReadFileTool.Name}', you must read files before attempting to modify them.

## Examples
<example>
user: Analyze the implementation of all typescript files in the src directory.
model:
I will read all the typescript files in the src directory.
[tool_call: ${ReadManyFilesTool.Name} for paths ['src/**/*.ts']]
</example>
<example>
user: I need to read the main readme and all markdown files in the docs directory.
model:
I will read the README.md and all markdown files in docs.
[tool_call: ${ReadManyFilesTool.Name} for paths ['README.md', 'docs/**/*.md']]
</example>
`.trim(),

 [EditTool.Name]: `
# Tool: ${EditTool.Name} (Find and Replace Text in a File)

## Description
Replaces an exact block of text within a specified file. This is the primary tool for refactoring and updating code.

## Parameters
- \`file_path\` (string, required): The absolute path to the file to modify.
- \`old_string\` (string, required): The exact literal text to replace.
- \`new_string\` (string, required): The exact literal text to replace \`old_string\` with.
- \`expected_replacements\` (number, optional): Number of replacements expected. Defaults to 1. Use when you want to replace multiple occurrences.

## Guidelines
- **Workflow (CRITICAL):** You MUST follow this sequence before editing:
    1.  **Find Absolute Path:** Use the \`GlobTool\` to find the absolute path of the file.
    2.  **Read File:** Use the \`ReadFileTool\` to read the file. This is mandatory for constructing the exact, multi-line \`old_string\`.
    3.  **Edit File:** Only after completing the steps above should you use this tool to modify the file.
- **Exact Matches Only (CRITICAL):** The \`old_string\` parameter must be an **exact, character-for-character match** of the content in the file, including all indentation, whitespace, and newlines (\`\n\`).
- **JSON Escaping (CRITICAL):** Both \`old_string\` and \`new_string\` are strings within a JSON object. They MUST be properly escaped. Newlines must be \`\n\`, tabs \`\t\`, double quotes \`\\"\`, and backslashes \`\\\\\`.
- **Adherence to Style:** Ensure \`new_string\` strictly mimics the style, formatting, and structure of the surrounding code.

- **Operational Modes:**
    - **Replacing Text:** Provide the \`old_string\` and the \`new_string\`.
    - **Inserting Text:** To insert, you must provide an adjacent line or block of text as the \`old_string\` and replace it with a \`new_string\` that contains the original text *plus* the text you want to insert.
    - **Deleting Text:** Provide the \`old_string\` and an empty string (\`""\`) for \`new_string\`.

## Examples
<example>
**Scenario: Modifying a block of text.**
**Task:** Add \`model: mockModel\` to the scheduler config.
**Model Calls:**
[tool_call: ${GlobTool.Name} for pattern '**/coreToolScheduler.test.ts']
[tool_call: ${ReadFileTool.Name} for absolute_path '/home/user/project/coreToolScheduler.test.ts']
[tool_call: ${EditTool.Name} for file_path '/home/user/project/coreToolScheduler.test.ts', old_string "const scheduler = new CoreToolScheduler({\n    config: mockConfig,\n  });", new_string "const scheduler = new CoreToolScheduler({\n    config: mockConfig,\n    model: mockModel\n  });"]
</example>

---
<example>
**Scenario: Inserting an import statement.**
**Model's Thought Process:** To insert, I will target the existing import line as my \`old_string\`, and my \`new_string\` will be that same line plus the new import on a new line.
**Model Calls:**
[tool_call: ${GlobTool.Name} for pattern '**/src/component.js']
[tool_call: ${ReadFileTool.Name} for absolute_path '/home/user/project/src/component.js']
[tool_call: ${EditTool.Name} for file_path '/home/user/project/src/component.js', old_string "import React from 'react';", new_string "import React from 'react';\nimport { useState } from 'react';"]
</example>

---
<example>
**Scenario: Deleting a function.**
**Model Calls:**
[tool_call: ${GlobTool.Name} for pattern '**/utils.py']
[tool_call: ${ReadFileTool.Name} for absolute_path '/home/user/project/utils.py']
[tool_call: ${EditTool.Name} for file_path '/home/user/project/utils.py', old_string "def old_function():\n    pass\n", new_string ""]
</example>
`.trim(),

  [WriteFileTool.Name]: `
# Tool: ${WriteFileTool.Name} (Write/Overwrite File)

## Description
Creates a new file with the specified content or completely overwrites an existing file.

## Parameters
- \`file_path\` (string, required): The absolute path of the file to write.
- \`content\` (string, required): The full content of the file.

## Guidelines
- **Absolute Paths MANDATORY.**
- **Primary Use Case: New Files:** Use this tool primarily for creating new files (e.g., scaffolding, new modules, new tests).
- **DANGER: Overwriting Existing Files:** This tool completely replaces the content of an existing file. Use '${EditTool.Name}' for modifications unless a full rewrite is absolutely necessary and you have read the file first.
- **JSON Escaping (CRITICAL):** The \`content\` parameter is a string within a JSON object. It MUST be properly escaped. Newlines must be \`\\n\`, tabs \`\\t\`, double quotes \`\\"\`, and backslashes \`\\\\\`. Failure to escape correctly will result in a failed tool call or corrupted file content.
- **Adherence to Style:** When creating a new file, ensure the \`content\` adheres to the conventions observed in similar files within the project.

## Examples
<example>
user: Create a new test file 'src/new.test.ts' with boilerplate code. Note the required JSON escaping (\\\\n).
model:
I will create the new test file.
[tool_call: ${WriteFileTool.Name} for absolute_path '/path/to/project/src/new.test.ts', content 'describe(\\"New Feature\\", () => {\\n  test(\\"should work\\", () => {\\n    expect(true).toBe(true);\\n  });\\n});']
</example>
<example>
user: Create a README.md file.
model:
I will create the README file.
[tool_call: ${WriteFileTool.Name} for absolute_path '/path/to/project/README.md', content '# Project Title\\n\\nDescription coming soon.']
</example>
`.trim(),

  [ShellTool.Name]: `
# Tool: ${ShellTool.Name} (Execute Shell Commands)

## Description
Executes commands in the system shell (bash/zsh/etc.).

## Parameters
- \`command\` (string, required): The shell command to execute.
- \`description\` (string, optional): Brief description of the command for the user. Be specific and concise. Ideally a single sentence. Can be up to 3 sentences for clarity. No line breaks.
- \`directory\` (string, optional): Directory to run the command in, if not the project root directory. Must be relative to the project root directory and must already exist.

## Guidelines
- **Use Cases:** Running tests, installing dependencies, managing git operations, scaffolding projects, building, linting, and system management.
- **Security Rule (CRITICAL):** Before executing any command that modifies the file system (e.g., \`rm\`, \`mv\`, \`mkdir\`, \`npm install\`, \`pip install\`), codebase, or system state, you MUST provide a brief explanation of the command's purpose and potential impact to the user.
- **Identify Project Commands:** Do not assume standard commands (like \`npm test\` or \`pytest\`). Always check project configuration (e.g., 'package.json' scripts, 'Makefile') to identify the correct commands for building, testing, and linting.
- **Verification:** Always use this tool to run the project-specific build, linting, and testing commands after making code changes.
- **Background Processes:** Use \`&\` for long-running processes like servers (e.g., \`node server.js &\`). If unsure if a command will block, ask the user.
- **Interactive Commands:** Avoid interactive commands (e.g., \`ssh\`, \`vim\`, \`git rebase -i\`). Prefer non-interactive alternatives (e.g., \`npm init -y\`). Warn the user if an interactive command is unavoidable.
- **Chaining Commands:** Combine related commands using \`&&\` for efficiency (e.g., \`npm run lint && npm test\` or \`git status && git diff\`).

## Examples
<example>
user: Install dependencies.
model: I will run \`npm install\` to install the project dependencies listed in package.json. This modifies the node_modules directory.
[tool_call: ${ShellTool.Name} for command 'npm install']
</example>

<example>
user: Run the tests.
model:
(Assuming 'package.json' analysis revealed the test script is 'npm run test:ci')
I will run the project's continuous integration test suite.
[tool_call: ${ShellTool.Name} for command 'npm run test:ci']
</example>

<example>
user: Delete the temp directory.
model: I will run \`rm -rf ./temp\`. This will permanently delete the 'temp' directory and all its contents within the current project.
[tool_call: ${ShellTool.Name} for command 'rm -rf ./temp']
</example>

<example>
user: Prepare a commit.
model:
I will check the status of the repository and review the changes before drafting a commit message.
[tool_call: ${ShellTool.Name} for command 'git status && git diff HEAD']
</example>
`.trim(),

  [MemoryTool.Name]: `
# Tool: ${MemoryTool.Name} (Remember User Facts)

## Description
Stores specific, user-related facts or preferences to persist across sessions.

## Parameters
- \`fact\` (string, required): The concise fact or preference to remember.

## Guidelines
- **Scope: User-Specific Only:** This tool is strictly for information about the user, not the project. Do not store project context, file locations, or code analysis results here.
- **When to Use:**
    1. When the user explicitly asks (e.g., "Remember that...").
    2. When the user states a clear preference that affects how you operate (e.g., preferred tools, specific coding style requirements, common environment variables they use).
- **Conciseness:** Keep the \`fact\` concise and actionable.
- **Confirmation:** If unsure whether a piece of information should be stored, ask the user: "Should I remember that for you?"

## Examples
<example>
user: Please remember that I prefer using 'yarn' instead of 'npm' for package management.
model:
Okay, I will remember your preference for 'yarn'.
[tool_call: ${MemoryTool.Name} for fact 'The user prefers using yarn over npm for package management.']
</example>
<example>
user: I always want you to use TypeScript instead of JavaScript when creating new files, even if the project currently uses both.
model:
Understood. I will prioritize TypeScript for new files.
[tool_call: ${MemoryTool.Name} for fact 'The user mandates the use of TypeScript (TS) over JavaScript (JS) for all new files created.']
</example>
`.trim(),

  [GetToolInfoTool.Name]: `
# Tool: ${GetToolInfoTool.Name} (Get Tool Information)

## Description
Provides detailed documentation, guidelines, and examples for the available tools. This is the tool you are currently using.

## Parameters
- \`tool_name\` (string, required): The name of the tool you need information about (e.g., '${WriteFileTool.Name}', '${MemoryTool.Name}', '${ShellTool.Name}').

## Guidelines
- **MANDATORY USAGE:** As per your Core Mandates, you MUST use this tool immediately before calling any other tool. This ensures you always have the most up-to-date information on parameters, usage patterns (like JSON escaping), and safety guidelines.
- **Clarification:** Use this whenever you have any uncertainty about how a tool functions.

## Examples
<example>
user: List the files.
model:
Before using the list tool, I must retrieve its documentation.
[tool_call: ${GetToolInfoTool.Name} for tool_name '${LSTool.Name}']
</example>
`.trim(),
};
