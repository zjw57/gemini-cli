/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Part } from '@google/genai';
import type { Config } from '../config/config.js';
import { getFolderStructure } from './getFolderStructure.js';
import { GlobTool } from '../tools/glob.js';
import { ReadFileTool } from '../tools/read-file.js';
import { partToString } from './partUtils.js';

/**
 * Generates a string describing the current workspace directories and their structures.
 * @param {Config} config - The runtime configuration and services.
 * @returns {Promise<string>} A promise that resolves to the directory context string.
 */
export async function getDirectoryContextString(
  config: Config,
): Promise<string> {
  const workspaceContext = config.getWorkspaceContext();
  const workspaceDirectories = workspaceContext.getDirectories();

  const folderStructures = await Promise.all(
    workspaceDirectories.map((dir) =>
      getFolderStructure(dir, {
        fileService: config.getFileService(),
      }),
    ),
  );

  const folderStructure = folderStructures.join('\n');

  let workingDirPreamble: string;
  if (workspaceDirectories.length === 1) {
    workingDirPreamble = `I'm currently working in the directory: ${workspaceDirectories[0]}`;
  } else {
    const dirList = workspaceDirectories.map((dir) => `  - ${dir}`).join('\n');
    workingDirPreamble = `I'm currently working in the following directories:\n${dirList}`;
  }

  return `${workingDirPreamble}
Here is the folder structure of the current working directories:

${folderStructure}`;
}

/**
 * Retrieves environment-related information to be included in the chat context.
 * This includes the current working directory, date, operating system, and folder structure.
 * Optionally, it can also include the full file context if enabled.
 * @param {Config} config - The runtime configuration and services.
 * @returns A promise that resolves to an array of `Part` objects containing environment information.
 */
export async function getEnvironmentContext(config: Config): Promise<Part[]> {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const platform = process.platform;
  const directoryContext = await getDirectoryContextString(config);

  const context = `
This is the Gemini CLI. We are setting up the context for our chat.
Today's date is ${today} (formatted according to the user's locale).
My operating system is: ${platform}
${directoryContext}
        `.trim();

  const initialParts: Part[] = [{ text: context }];
  const toolRegistry = config.getToolRegistry();

  // Add full file context if the flag is set
  if (config.getFullContext()) {
    try {
      const globTool = toolRegistry.getTool(GlobTool.Name);
      const readFileTool = toolRegistry.getTool(ReadFileTool.Name);

      if (globTool && readFileTool) {
        // 1. Use GlobTool to find all files
        const globInvocation = globTool.build({
          pattern: '**/*', // Read everything recursively
          // GlobTool respects default excludes by default (via .gitignore/.geminiignore)
        });

        const globResult = await globInvocation.execute(
          AbortSignal.timeout(30000),
        );

        const globContent = partToString(globResult.llmContent);

        if (!globContent) {
          console.warn('Full context requested, but glob returned no content.');
        } else {
          // Parse the glob output (header line followed by paths)
          const lines = globContent.split('\n');
          // Skip the header line if present (it usually starts with "Found X files...")
          const filePaths = lines
            .slice(1)
            .filter((line: string) => line.trim() !== '');

          if (filePaths.length === 0) {
            console.warn('Full context requested, but no files found by glob.');
          } else {
            // 2. Read each file using ReadFileTool in parallel
            const readPromises = filePaths.map(async (filePath: string) => {
              try {
                const readInvocation = readFileTool.build({
                  absolute_path: filePath,
                });
                const readResult = await readInvocation.execute(
                  AbortSignal.timeout(5000), // Shorter timeout per file
                );
                const readContent = partToString(readResult.llmContent);
                if (readContent) {
                  return `--- ${filePath} ---\n${readContent}\n\n`;
                }
                return '';
              } catch (readError) {
                console.warn(
                  `Failed to read file ${filePath} for full context:`,
                  readError,
                );
                return `--- ${filePath} ---\nError reading file.\n\n`;
              }
            });

            const fileContents = await Promise.all(readPromises);
            let fullContent = fileContents.join('');

            if (fullContent) {
              fullContent += '--- End of content ---';
              initialParts.push({
                text: `\n--- Full File Context ---\n${fullContent}`,
              });
            }
          }
        }
      } else {
        console.warn(
          `Full context requested, but required tools (${GlobTool.Name}, ${ReadFileTool.Name}) not found.`,
        );
      }
    } catch (error) {
      // Not using reportError here as it's a startup/config phase, not a chat/generation phase error.
      console.error('Error reading full file context:', error);
      initialParts.push({
        text: '\n--- Error reading full file context ---',
      });
    }
  }

  return initialParts;
}
