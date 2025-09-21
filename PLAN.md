# Plan for Implementing the Reviewer Tool

This document outlines the plan for creating a new "reviewer" tool for the Gemini CLI agent. The purpose of this tool is to act as a qualitative analysis and advisory function. It will analyze the current conversation to provide a critique of the work done, ensuring the main agent stays on track and maintains high-quality output.

## 1. Goal Definition

The reviewer tool's core function is to provide a "second opinion" on the agent's work. It will not execute commands itself. Instead, it will analyze the session's history and the agent's stated goal to produce a critique. This critique will guide the main agent, prompting it to run necessary quality checks (if missed) or to revise its work based on the feedback.

## 2. Tool Implementation

A new tool named `reviewer` will be implemented. Its single parameter will be the agent's summary of the user's goal, which serves as a baseline for the review.

### 2.1. Create Tool File

- Create a new file: `packages/core/src/tools/reviewer.ts`

### 2.2. Implement `ReviewerTool`

The `reviewer.ts` file will contain the following:

- **`ReviewerTool` class:**
  - Extends `BaseDeclarativeTool`.
  - Sets the tool name to `reviewer`.
  - Provides a description: "Analyzes the conversation and work done so far to provide a critique and suggest next steps for ensuring quality. It checks if the work aligns with the user's task, if quality checks like building and testing have been considered, and if the overall approach is sound."
  - Defines a parameter schema with one required property:
    - `task_description` (string): A summary of the user's request or goal that the agent has been working on.

- **`ReviewerToolInvocation` class:**
  - Extends `BaseToolInvocation`.
  - Implements the `execute` method, which will have access to the current `GeminiChat` session object to get the conversation history.

### 2.3. `execute` Method Logic

The `execute` method will perform a single, powerful analysis step:

1.  **Context Gathering:** The tool will access the full chat history from the `GeminiChat` session. It will also identify any files that have been modified by looking for `write_file` and `replace` tool calls in the history and will read their latest content.

2.  **LLM-Powered Analysis:** The tool will make a single call to the Gemini model with a specialized, detailed prompt. This prompt will contain:
    - The `task_description` provided by the agent.
    - The full chat history.
    - The content of the modified files.
    - A set of instructions for the model, asking it to act as an expert code reviewer and project manager. The instructions will ask the model to generate a critique that addresses the following points:
      - **Alignment:** Does the work performed (as seen in the file changes and tool calls) align with the `task_description`? Are there any misunderstandings or missed requirements?
      - **Quality Checks:** Based on the project context in the chat history, have appropriate quality checks (like building, linting, or testing) been performed? If not, the critique should recommend that the main agent run them.
      - **Code Quality:** Is the code in the modified files well-written, idiomatic, and correct?
      - **Completeness:** Does the work appear to be complete, or are there logical next steps that have been overlooked?

3.  **Output:** The raw response from the Gemini model's analysis will be the entire output of the tool. This natural language critique will be sent back to the main agent.

## 3. Tool Registration

The new `ReviewerTool` will be registered in `packages/core/src/config/config.ts`.

- Import the `ReviewerTool` class.
- In the `createToolRegistry` method, add a call to `registerCoreTool(ReviewerTool, this);`.

## 4. Prompt Engineering

The system prompts in `packages/core/src/core/prompts.ts` will be updated to instruct the agent on how and when to use the `reviewer` tool.

- The instructions will guide the agent to call the `reviewer` tool to get a "second opinion" on its work, especially after significant changes or before finishing a task.
- It will be framed as a way to ensure high quality and to double-check its own reasoning.
