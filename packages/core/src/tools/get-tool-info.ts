/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LSTool } from '../tools/ls.js';
import { EditTool } from '../tools/edit.js';
import { GlobTool } from '../tools/glob.js';
import { GrepTool } from '../tools/grep.js';
import { ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ShellTool } from '../tools/shell.js';
import { WriteFileTool } from '../tools/write-file.js';
import { MemoryTool } from '../tools/memoryTool.js';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { Config } from '../config/config.js';

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

export class GetToolInfoTool extends BaseTool<GetToolInfoParams, ToolResult> {
  static Name: string = 'get_tool_info';

  constructor(private readonly config: Config) {
    super(
      GetToolInfoTool.Name,
      'Get Tool Info',
      'Provides detailed documentation for a given tool.',
      Icon.FileSearch,
      {
        type: Type.OBJECT,
        properties: {
          tool_name: {
            type: Type.STRING,
            description: 'The name of the tool to get information about.',
          },
        },
        required: ['tool_name'],
      },
      true, // output is markdown
      false, // output cannot be updated
    );
  }

  getDescription(): string {
    const description = `${this.description}`;
    return description;
  }

  validateToolParams(): string | null {
    return null;
  }

  async shouldConfirmExecute(
    _params: GetToolInfoParams,
    _abortSignal: AbortSignal,
  ): Promise<false> {
    return false;
  }

  async execute(
    params: GetToolInfoParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const toolName = params.tool_name;
    const content = TOOL_INFO[toolName] || `Error: Documentation not found for tool "${toolName}". Please ensure the tool name is correct.`;
    return {
      llmContent: [{ text: content }],
      returnDisplay: '',
      summary: `Displayed documentation for ${toolName}`,
    };
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
- \`path\` (string, required): The absolute path of the directory to list.

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
- \`pattern\` (string, required): The glob pattern to search for, relative to the project root.

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
Use this tool to perform a project-wide search within the contents of all files for specific text patterns or regular expressions.

## Parameters
- \`pattern\` (string, required): The text pattern or regular expression to search for.

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
[tool_call: ${GrepTool.Name} for pattern "(import.*from 'lodash'|require\\('lodash'\\))"]
</example>
`.trim(),

  [ReadFileTool.Name]: `
# Tool: ${ReadFileTool.Name} (Read File Content)

## Description
Reads the full content of a single specified file.

## Parameters
- \`absolute_path\` (string, required): The absolute path of the file to read.

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
Reads the full content of multiple specified files in a single operation.

## Parameters
- \`absolute_paths\` (array of strings, required): An array of absolute paths of the files to read.

## Guidelines
- **Absolute Paths MANDATORY:** All paths in the array MUST be absolute paths.
- **Contextual Understanding:** This is the preferred method when you need to understand how multiple files interact (e.g., a component and its stylesheet, an implementation file and its test file).
- **Verify Before Modifying (CRUCIAL):** As with '${ReadFileTool.Name}', you must read files before attempting to modify them.

## Examples
<example>
user: Analyze the implementation of UserProfile.tsx and its test file.
model:
I will read both the implementation and the test file simultaneously to understand the context.
[tool_call: ${ReadManyFilesTool.Name} for absolute_paths ['/path/to/src/UserProfile.tsx', '/path/to/tests/UserProfile.test.tsx']]
</example>
<example>
user: I need to update the API service and its configuration.
model:
I will read the service file and the configuration file together.
[tool_call: ${ReadManyFilesTool.Name} for absolute_paths ['/path/to/src/services/api.js', '/path/to/config/settings.json']]
</example>
`.trim(),

  [EditTool.Name]: `
# Tool: ${EditTool.Name} (Edit Section of a File by Line Numbers)

## Description
Modifies a specific, contiguous block of lines within an existing file. This is the primary tool for refactoring and updating code.

## Parameters
- \`absolute_path\` (string, required): The absolute path of the file to edit.
- \`start_line\` (number, required): The starting line number (1-indexed, inclusive) of the operation.
- \`end_line\` (number, required): The ending line number (1-indexed, inclusive) of the section to replace.
- \`new_content\` (string, required): The new content to insert.

## Guidelines
- **Absolute Paths MANDATORY.**
- **Read First (CRITICAL):** You MUST read the file immediately before using this tool to ensure the line numbers are accurate and that you understand the code conventions.
- **JSON Escaping (CRITICAL):** The \`new_content\` parameter is a string within a JSON object. It MUST be properly escaped. Newlines must be \`\\n\`, tabs \`\\t\`, double quotes \`\\"\`, and backslashes \`\\\\\`. Failure to escape correctly will result in a failed tool call or corrupted file content.
- **Adherence to Style:** Ensure \`new_content\` strictly mimics the style, formatting, and structure of the surrounding code.
- **Line Indexing:** Line numbers are 1-indexed.

- **Operational Modes:**
    - **Replacing Lines:** Set \`start_line\` and \`end_line\` to the range you want to replace (e.g., start=10, end=15). The entire range is removed and replaced by \`new_content\`.
    - **Inserting Lines:** To insert code without deleting existing lines, set \`end_line\` to be \`start_line\` - 1. (e.g., To insert at line 10, use start=10, end=9).
    - **Deleting Lines:** Provide an empty string for \`new_content\` and set the range to delete (e.g., start=10, end=15, content='').

## Examples
<example>
Scenario: Replacing a function (lines 10-12). Note the required JSON escaping (\\\\n).
Model Call:
[tool_call: ${EditTool.Name} for absolute_path '/path/to/project/src/finance.js', start_line 10, end_line 12, new_content 'function calculateTax(amount) {\\n  const rate = 0.08;\\n  return amount * rate;\\n}']
</example>

<example>
Scenario: Inserting an import at line 2 (without deleting line 2). Use end_line = start_line - 1.
Model Call:
[tool_call: ${EditTool.Name} for absolute_path '/path/to/project/src/component.js', start_line 2, end_line 1, new_content "import { useState } from 'react';\\n"]
</example>

<example>
Scenario: Deleting lines (lines 5-7). Use empty new_content.
Model Call:
[tool_call: ${EditTool.Name} for absolute_path '/path/to/project/utils.py', start_line 5, end_line 7, new_content '']
</example>
`.trim(),

  [WriteFileTool.Name]: `
# Tool: ${WriteFileTool.Name} (Write/Overwrite File)

## Description
Creates a new file with the specified content or completely overwrites an existing file.

## Parameters
- \`absolute_path\` (string, required): The absolute path of the file to write.
- \`content\` (string, required): The full content of the file.

## Guidelines
- **Absolute Paths MANDATORY.**
- **Primary Use Case: New Files:** Use this tool primarily for creating new files (e.g., scaffolding, new modules, new tests).
- **DANGER: Overwriting Existing Files:** This tool completely replaces the content of an existing file. Use '${EditTool.Name}' for modifications unless a full rewrite is absolutely necessary and you have read the file first.
- **JSON Escaping (CRITICAL):** The \`content\` parameter is a string within a JSON object. It MUST be properly escaped. Newlines must be \`\\n\`, tabs \`\\t\`, double quotes \`\\"\`, and backslashes \`\\\\\`. Failure to escape correctly will result in a failed tool call or corrupted file content.
- **Adherence to Style:** When creating a new file, ensure the \`content\` adheres to the conventions observed in similar files within the project.

## Examples
<example>
user: Create a new test file 'src/new.test.ts' with boilerplate code. Note the required JSON escaping (\\\\n, \\\\").
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