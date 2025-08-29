/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, Icon, ToolResult } from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { Type } from '@google/genai';
// Adapted from langchain/deepagents for experimentation
export const WRITE_TODOS_DESCRIPTION = `Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

Use this tool when:
1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: I'll help add a dark mode toggle to your application settings. Let me create a todo list to track this implementation.
*Creates todo list with the following items:*
1. Create dark mode toggle component in Settings page
2. Add dark mode state management (context/store)
3. Implement CSS-in-JS styles for dark theme
4. Update existing components to support theme switching
5. Run tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and styling changes
2. The user explicitly requested tests and build be run afterward
3. The assistant inferred that tests and build need to pass by adding "Ensure tests and build succeed" as the final task
</reasoning>
</example>


<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: Let me first search through your codebase to find all occurrences of 'getCwd'.
*Uses search tools to locate all instances of getCwd in the codebase*
Assistant: I've found 15 instances of 'getCwd' across 8 different files. Let me create a todo list to track these changes.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. First, the assistant searched to understand the scope of the task
2. Upon finding multiple occurrences across different files, it determined this was a complex task with multiple steps
3. The todo list helps ensure every instance is tracked and updated systematically
4. This approach prevents missing any occurrences and maintains consistency
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

\`\`\`python
print("Hello World")
\`\`\`
This will output the text "Hello World" to the console when executed.</assistant>

<reasoning>
The assistant did not use the todo list because this is a single, trivial task that can be completed in one step. There's no need to track multiple tasks or steps for such a straightforward request.
</reasoning>
</example>

<example>
User: What time is it in Tokyo right now?
Assistant: I'll check the current time in Tokyo for you.

*Searches for current time in Tokyo*

The current time in Tokyo, Japan is [current time]. Tokyo is in the Japan Standard Time (JST) zone, which is UTC+9.

<reasoning>
The assistant did not use the todo list because this is a single information lookup with immediate results. There are no multiple steps to track or organize, making the todo list unnecessary for this straightforward request.
</reasoning>
</example>


When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`;
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  description: string;
  status: TodoStatus;
}

export interface WriteTodosToolParams {
  /**
   * The full list of todos. This will overwrite any existing list.
   */
  todos: Todo[];
}

export class WriteTodosTool extends BaseTool<WriteTodosToolParams, ToolResult> {
  static readonly Name: string = 'write_todos_list';

  // In-memory store for the session's todos.
  private static todos: Todo[] = [];

  constructor() {
    super(
      WriteTodosTool.Name,
      'Write Todos',
      WRITE_TODOS_DESCRIPTION,
      Icon.Checklist,
      {
        properties: {
          todos: {
            type: Type.ARRAY,
            description:
              'The complete list of todo items. This will replace the existing list.',
            items: {
              type: Type.OBJECT,
              description: 'A single todo item.',
              properties: {
                description: {
                  type: Type.STRING,
                  description: 'The description of the task.',
                },
                status: {
                  type: Type.STRING,
                  description: 'The current status of the task.',
                  enum: ['pending', 'in_progress', 'completed'],
                },
              },
              required: ['description', 'status'],
            },
          },
        },
        required: ['todos'],
        type: Type.OBJECT,
      },
    );
  }

  /**
   * Static method to get the current list of todos.
   * NOTE: This is intended for testing purposes.
   * @returns The current list of todos.
   */
  static getTodos(): Todo[] {
    return WriteTodosTool.todos;
  }

  /**
   * Static method to reset the list of todos.
   * NOTE: This is intended for testing purposes.
   */
  static resetTodos(): void {
    WriteTodosTool.todos = [];
  }

  validateToolParams(params: WriteTodosToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    const inProgressCount = params.todos.filter(
      (todo) => todo.status === 'in_progress',
    ).length;
    if (inProgressCount > 1) {
      return 'Invalid parameters: Only one task can be "in_progress" at a time.';
    }

    return null;
  }

  getDescription(params: WriteTodosToolParams): string {
    const count = params.todos?.length ?? 0;
    if (count === 0) {
      return 'Cleared todo list';
    }
    return `Set ${count} todo(s)`;
  }

  async execute(
    params: WriteTodosToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    WriteTodosTool.todos = params.todos;

    const todoListString = WriteTodosTool.todos
      .map(
        (todo, index) => `${index + 1}. [${todo.status}] ${todo.description}`,
      )
      .join('\n');

    const llmContent =
      WriteTodosTool.todos.length > 0
        ? `Successfully updated the todo list. The current list is now:\n${todoListString}`
        : 'Successfully cleared the todo list.';

    return {
      llmContent,
      returnDisplay: llmContent,
    };
  }
}
