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
    let description = `${this.description}`;
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
    console.error('hit')
    const toolName = params.tool_name;
    const content = TOOL_INFO[toolName] || '';
    return {
      llmContent: [{ text: content }],
      returnDisplay: content,
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
Use this tool to explore the file system structure and see what files exist in a directory.

## Parameters
- \`path\` (string, required): The absolute path of the directory to list.

## Guidelines
- Always provide an absolute path.

## Examples
<example>
user: list files here.
model: [tool_call: ${LSTool.Name} for path '/path/to/project']
</example>

<example>
user: What's in the src/utils folder?
model: [tool_call: ${LSTool.Name} for path '/path/to/project/src/utils']
</example>
`.trim(),

  [GlobTool.Name]: `
# Tool: ${GlobTool.Name} (Find Files by Pattern)

## Description
Use this tool to search for files matching specific patterns (globs). This is crucial for discovering file locations, understanding project structure, and finding related files (e.g., tests, configurations).

## Parameters
- \`pattern\` (string, required): The glob pattern to search for (e.g., 'src/**/*.ts', '**/README.md').

## Guidelines
- Use broad patterns initially to understand the structure, then narrow them down.
- Excellent for finding test files (e.g., '**/*.test.js') or configuration files.

## Examples
<example>
user: Where are all the 'app.config' files in this project?
model:
[tool_call: ${GlobTool.Name} for pattern '**/app.config']
</example>
<example>
user: Find all typescript files in the src directory.
model:
[tool_call: ${GlobTool.Name} for pattern 'src/**/*.ts']
</example>
`.trim(),

  [GrepTool.Name]: `
# Tool: ${GrepTool.Name} (Search File Contents)

## Description
Use this tool to search within the contents of all files in the project for specific text patterns or keywords.

## Parameters
- \`pattern\` (string, required): The text pattern or regular expression to search for.

## Guidelines
- Essential for understanding how functions, classes, variables, or API endpoints are used across the codebase.
- Use this extensively during the "Understand" phase of any task.
- Combine multiple related terms using '|' (e.g., 'UserProfile|updateProfile|editUser').

## Examples
<example>
user: How is the 'authenticateUser' function used in this project?
model:
[tool_call: ${GrepTool.Name} for pattern 'authenticateUser']
</example>
<example>
user: I need to find where we configure the database connection string.
model:
I will search for common terms related to database configuration.
[tool_call: ${GrepTool.Name} for pattern 'DB_CONNECTION|DATABASE_URL|connectionString']
</example>
`.trim(),

  [ReadFileTool.Name]: `
# Tool: ${ReadFileTool.Name} (Read File Content)

## Description
Reads the full content of a single specified file.

## Parameters
- \`absolute_path\` (string, required): The absolute path of the file to read.

## Guidelines
- **Crucial Rule:** NEVER make assumptions about the contents of files. Always read them first to understand context, conventions, implementation details, and dependencies.
- Use this to analyze code before modifying it, or to check configuration files (like 'package.json').
- If reading multiple files, consider using '${ReadManyFilesTool.Name}' instead.

## Examples
<example>
user: Check if 'axios' is a dependency in package.json.
model:
[tool_call: ${ReadFileTool.Name} for absolute_path '/path/to/project/package.json']
</example>
`.trim(),

  [ReadManyFilesTool.Name]: `
# Tool: ${ReadManyFilesTool.Name} (Read Multiple Files Content)

## Description
Reads the full content of multiple specified files in parallel.

## Parameters
- \`absolute_paths\` (array of strings, required): An array of absolute paths of the files to read.

## Guidelines
- Preferred over '${ReadFileTool.Name}' when you need to understand the context of several related files simultaneously (e.g., implementation and its corresponding test file, or a module and its configuration).
- **Crucial Rule:** NEVER make assumptions about file contents. Always read them first.

## Examples
<example>
user: Analyze the implementation of UserProfile.tsx and its test file.
model:
[tool_call: ${ReadManyFilesTool.Name} for absolute_paths ['/path/to/src/UserProfile.tsx', '/path/to/tests/UserProfile.test.tsx']]
</example>
`.trim(),

  [EditTool.Name]: `
# Tool: ${EditTool.Name} (Edit Section of a File)

## Description
Modifies a specific section of an existing file. (Note: Parameters depend on the specific implementation of the EditTool, e.g., line numbers or search/replace strings).

## Parameters (Example based on line numbers)
- \`absolute_path\` (string, required): The absolute path of the file to edit.
- \`start_line\` (number, required): The starting line number (inclusive) of the section to replace.
- \`end_line\` (number, required): The ending line number (inclusive) of the section to replace.
- \`new_content\` (string, required): The new content to insert in the specified range.

## Guidelines
- Preferred for targeted changes (like refactoring a function, updating a specific configuration block) as it preserves the surrounding context and is safer than overwriting the whole file.
- Always read the file first to determine the correct context and understand the existing code conventions.
- Ensure \`new_content\` strictly adheres to the project's style and structure.

## Examples
<example>
user: Refactor the 'calculateTax' function in src/finance.js (lines 10-20) to use the new rate.
model:
(Assuming the file has been read and analyzed)
[tool_call: ${EditTool.Name} for absolute_path '/path/to/project/src/finance.js', start_line 10, end_line 20, new_content 'function calculateTax(amount) {\\n  return amount * 0.08;\\n}']
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
- Primarily used for creating new files (e.g., new source files, tests, configuration files).
- Use with caution on existing files, as it overwrites everything. '${EditTool.Name}' is generally safer for modifications.
- Ensure the content strictly adheres to the project's established conventions.

## Examples
<example>
user: Create a new test file 'src/new.test.ts' with boilerplate code.
model:
[tool_call: ${WriteFileTool.Name} for absolute_path '/path/to/project/src/new.test.ts', content 'describe(\\"New Feature\\", () => {\\n  test(\\"should work\\", () => {\\n    expect(true).toBe(true);\\n  });\\n});']
</example>
`.trim(),

  [ShellTool.Name]: `
# Tool: ${ShellTool.Name} (Execute Shell Commands)

## Description
Executes commands in the system shell.

## Parameters
- \`command\` (string, required): The shell command to execute.

## Guidelines
- Use for running tests, installing dependencies, managing git, scaffolding projects, building, linting, etc.
- **Security Rule (CRITICAL):** Before executing commands that modify the file system, codebase, or system state, you *must* provide a brief explanation of the command's purpose and potential impact.
- **Background Processes:** Use background processes (via \`&\`) for commands that are unlikely to stop on their own (e.g., servers). Example: \`node server.js &\`. If unsure, ask the user.
- **Interactive Commands:** Avoid commands requiring user interaction (e.g. \`git rebase -i\`). Use non-interactive versions when available (e.g. \`npm init -y\`). If unavoidable, warn the user that interactive commands may cause hangs.
- **Verification:** Always use this tool to run the project-specific build, linting, and testing commands after making changes.

## Examples
<example>
user: Install dependencies.
model: I will run \`npm install\` to install the project dependencies listed in package.json.
[tool_call: ${ShellTool.Name} for command 'npm install']
</example>

<example>
user: start the server implemented in server.js
model: [tool_call: ${ShellTool.Name} for command 'node server.js &' because it must run in the background]
</example>

<example>
user: Delete the temp directory.
model: I can run \`rm -rf /path/to/project/temp\`. This will permanently delete the directory and all its contents.
[tool_call: ${ShellTool.Name} for command 'rm -rf /path/to/project/temp']
</example>
`.trim(),

  [MemoryTool.Name]: `
# Tool: ${MemoryTool.Name} (Remember User Facts)

## Description
Stores specific, user-related facts or preferences to persist across sessions.

## Parameters
- \`fact\` (string, required): The concise fact or preference to remember.

## Guidelines
- Use when the user explicitly asks you to remember something.
- Use when the user states a clear preference that would streamline future interactions (e.g., preferred coding style, common aliases, specific environment details they always use).
- Do *not* use this for general project context or information discovered during code analysis.
- If unsure whether to save something, ask the user: "Should I remember that for you?"

## Examples
<example>
user: Please remember that I prefer using 'yarn' instead of 'npm' for package management.
model:
[tool_call: ${MemoryTool.Name} for fact 'The user prefers using yarn over npm for package management.']
</example>
`.trim(),

  [GetToolInfoTool.Name]: `
# Tool: ${GetToolInfoTool.Name} (Get Tool Information)

## Description
Provides detailed documentation, guidelines, and examples for the available tools. This is the tool you are currently using.

## Parameters
- \`tool_name\` (string, required): The name of the tool you need information about (e.g., 'write_file', 'save_memory', 'run_shell_command').

## Guidelines
- Use this whenever you are unsure about a tool's parameters or behavior.
`.trim(),
};