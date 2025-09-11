/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isSubpath } from './paths.js';
import { marked } from 'marked';

// Simple console logger for import processing
const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) =>
    console.debug('[DEBUG] [ImportProcessor]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn: (...args: any[]) => console.warn('[WARN] [ImportProcessor]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...args: any[]) =>
    console.error('[ERROR] [ImportProcessor]', ...args),
};

/**
 * Interface for tracking import processing state to prevent circular imports
 */
interface ImportState {
  processedFiles: Set<string>;
  maxDepth: number;
  currentDepth: number;
  currentFile?: string; // Track the current file being processed
}

/**
 * Interface representing a file in the import tree
 */
export interface MemoryFile {
  path: string;
  imports?: MemoryFile[]; // Direct imports, in the order they were imported
}

/**
 * Result of processing imports
 */
export interface ProcessImportsResult {
  content: string;
  importTree: MemoryFile;
}

// Helper to find the project root (looks for .git directory)
async function findProjectRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(currentDir, '.git');
    try {
      const stats = await fs.lstat(gitPath);
      if (stats.isDirectory()) {
        return currentDir;
      }
    } catch {
      // .git not found, continue to parent
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }
  // Fallback to startDir if .git not found
  return path.resolve(startDir);
}

// Add a type guard for error objects
function hasMessage(err: unknown): err is { message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  );
}

// Helper to find all code block and inline code regions using marked
/**
 * Represents a file import (@path/to/file)
 */
interface FileImport {
  type: 'file';
  start: number;
  _end: number;
  path: string;
}

/**
 * Represents an MCP resource import (@server:resource-uri)
 */
interface ResourceImport {
  type: 'resource';
  start: number;
  _end: number;
  serverName: string;
  resourceUri: string;
}

type ImportItem = FileImport | ResourceImport;

/**
 * Finds all import statements in content without using regex
 * @returns Array of import objects for files and MCP resources found
 */
function findImports(
  content: string,
): ImportItem[] {
  const imports: ImportItem[] = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    // Find next @ symbol
    i = content.indexOf('@', i);
    if (i === -1) break;

    // Check if it's a word boundary (not part of another word)
    if (i > 0 && !isWhitespace(content[i - 1])) {
      i++;
      continue;
    }

    // Find the end of the import path (whitespace or newline)
    let j = i + 1;
    while (
      j < len &&
      !isWhitespace(content[j]) &&
      content[j] !== '\n' &&
      content[j] !== '\r'
    ) {
      j++;
    }

    // Extract the path (everything after @)
    const importPath = content.slice(i + 1, j);

    if (importPath.length > 0) {
      // Check if it's an MCP resource import (contains a colon)
      const colonIndex = importPath.indexOf(':');
      if (colonIndex > 0 && colonIndex < importPath.length - 1) {
        // MCP resource format: @server:resource-uri
        const serverName = importPath.slice(0, colonIndex);
        const resourceUri = importPath.slice(colonIndex + 1);
        
        // Validate server name (letters, numbers, underscores, hyphens)
        // Must start with letter, can't end with hyphen or underscore
        // and resource URI (non-empty and reasonable length)
        const serverNameValid = serverName.length === 1 
          ? /^[a-zA-Z]$/.test(serverName)
          : /^[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(serverName);
          
        if (
          serverNameValid && 
          resourceUri.length > 0 && 
          resourceUri.length < 2048 && // Reasonable URI length limit
          !resourceUri.includes('\n') && // No newlines in URI
          !resourceUri.includes('\r') // No carriage returns in URI
        ) {
          imports.push({
            type: 'resource',
            start: i,
            _end: j,
            serverName,
            resourceUri,
          });
        }
      } else {
        // File import validation (starts with ./ or / or letter)
        if (
          importPath[0] === '.' ||
          importPath[0] === '/' ||
          isLetter(importPath[0])
        ) {
          imports.push({
            type: 'file',
            start: i,
            _end: j,
            path: importPath,
          });
        }
      }
    }

    i = j + 1;
  }

  return imports;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122)
  ); // a-z
}

function findCodeRegions(content: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const tokens = marked.lexer(content);

  // Map from raw content to a queue of its start indices in the original content.
  const rawContentIndices = new Map<string, number[]>();

  function walk(token: { type: string; raw: string; tokens?: unknown[] }) {
    if (token.type === 'code' || token.type === 'codespan') {
      if (!rawContentIndices.has(token.raw)) {
        const indices: number[] = [];
        let lastIndex = -1;
        while ((lastIndex = content.indexOf(token.raw, lastIndex + 1)) !== -1) {
          indices.push(lastIndex);
        }
        rawContentIndices.set(token.raw, indices);
      }

      const indices = rawContentIndices.get(token.raw);
      if (indices && indices.length > 0) {
        // Assume tokens are processed in order of appearance.
        // Dequeue the next available index for this raw content.
        const idx = indices.shift()!;
        regions.push([idx, idx + token.raw.length]);
      }
    }

    if ('tokens' in token && token.tokens) {
      for (const child of token.tokens) {
        walk(child as { type: string; raw: string; tokens?: unknown[] });
      }
    }
  }

  for (const token of tokens) {
    walk(token);
  }

  return regions;
}

/**
 * Processes import statements in GEMINI.md content
 * Supports @path/to/file syntax for importing content from other files
 * and @server:resource-uri syntax for importing content from MCP resources
 * @param content - The content to process for imports
 * @param basePath - The directory path where the current file is located
 * @param debugMode - Whether to enable debug logging
 * @param importState - State tracking for circular import prevention
 * @param projectRoot - The project root directory for allowed directories
 * @param importFormat - The format of the import tree
 * @param resourceRegistry - Optional resource registry for MCP resource imports
 * @returns Processed content with imports resolved and import tree
 */
export async function processImports(
  content: string,
  basePath: string,
  debugMode: boolean = false,
  importState: ImportState = {
    processedFiles: new Set(),
    maxDepth: 5,
    currentDepth: 0,
  },
  projectRoot?: string,
  importFormat: 'flat' | 'tree' = 'tree',
  resourceRegistry?: any, // ResourceRegistry type - avoid circular import for now
): Promise<ProcessImportsResult> {
  if (!projectRoot) {
    projectRoot = await findProjectRoot(basePath);
  }

  if (importState.currentDepth >= importState.maxDepth) {
    if (debugMode) {
      logger.warn(
        `Maximum import depth (${importState.maxDepth}) reached. Stopping import processing.`,
      );
    }
    return {
      content,
      importTree: { path: importState.currentFile || 'unknown' },
    };
  }

  // --- FLAT FORMAT LOGIC ---
  if (importFormat === 'flat') {
    // Use a queue to process files in order of first encounter, and a set to avoid duplicates
    const flatFiles: Array<{ path: string; content: string }> = [];
    // Track processed files across the entire operation
    const processedFiles = new Set<string>();

    // Helper to recursively process imports
    async function processFlat(
      fileContent: string,
      fileBasePath: string,
      filePath: string,
      depth: number,
    ) {
      // Normalize the file path to ensure consistent comparison
      const normalizedPath = path.normalize(filePath);

      // Skip if already processed
      if (processedFiles.has(normalizedPath)) return;

      // Mark as processed before processing to prevent infinite recursion
      processedFiles.add(normalizedPath);

      // Add this file to the flat list
      flatFiles.push({ path: normalizedPath, content: fileContent });

      // Find imports in this file
      const codeRegions = findCodeRegions(fileContent);
      const imports = findImports(fileContent);

      // Process imports in reverse order to handle indices correctly
      for (let i = imports.length - 1; i >= 0; i--) {
        const importItem = imports[i];
        const { start } = importItem;

        // Skip if inside a code region
        if (
          codeRegions.some(
            ([regionStart, regionEnd]) =>
              start >= regionStart && start < regionEnd,
          )
        ) {
          continue;
        }

        // Only process file imports in flat format, skip MCP resources for now
        if (importItem.type !== 'file') {
          continue;
        }

        const importPath = importItem.path;

        // Validate import path
        if (
          !validateImportPath(importPath, fileBasePath, [projectRoot || ''])
        ) {
          continue;
        }

        const fullPath = path.resolve(fileBasePath, importPath);
        const normalizedFullPath = path.normalize(fullPath);

        // Skip if already processed
        if (processedFiles.has(normalizedFullPath)) continue;

        try {
          await fs.access(fullPath);
          const importedContent = await fs.readFile(fullPath, 'utf-8');

          // Process the imported file
          await processFlat(
            importedContent,
            path.dirname(fullPath),
            normalizedFullPath,
            depth + 1,
          );
        } catch (error) {
          if (debugMode) {
            logger.warn(
              `Failed to import ${fullPath}: ${hasMessage(error) ? error.message : 'Unknown error'}`,
            );
          }
          // Continue with other imports even if one fails
        }
      }
    }

    // Start with the root file (current file)
    const rootPath = path.normalize(
      importState.currentFile || path.resolve(basePath),
    );
    await processFlat(content, basePath, rootPath, 0);

    // Concatenate all unique files in order, Claude-style
    const flatContent = flatFiles
      .map(
        (f) =>
          `--- File: ${f.path} ---\n${f.content.trim()}\n--- End of File: ${f.path} ---`,
      )
      .join('\n\n');

    return {
      content: flatContent,
      importTree: { path: rootPath }, // Tree not meaningful in flat mode
    };
  }

  // --- TREE FORMAT LOGIC (existing) ---
  const codeRegions = findCodeRegions(content);
  let result = '';
  let lastIndex = 0;
  const imports: MemoryFile[] = [];
  const importsList = findImports(content);

  for (const importItem of importsList) {
    const { start, _end } = importItem;
    
    // Add content before this import
    result += content.substring(lastIndex, start);
    lastIndex = _end;

    // Skip if inside a code region
    if (codeRegions.some(([s, e]) => start >= s && start < e)) {
      if (importItem.type === 'file') {
        result += `@${importItem.path}`;
      } else {
        result += `@${importItem.serverName}:${importItem.resourceUri}`;
      }
      continue;
    }

    if (importItem.type === 'file') {
      // Handle file imports
      const importPath = importItem.path;
      
      // Validate import path to prevent path traversal attacks
      if (!validateImportPath(importPath, basePath, [projectRoot || ''])) {
        result += `<!-- Import failed: ${importPath} - Path traversal attempt -->`;
        continue;
      }
      const fullPath = path.resolve(basePath, importPath);
      if (importState.processedFiles.has(fullPath)) {
        result += `<!-- File already processed: ${importPath} -->`;
        continue;
      }
      try {
        await fs.access(fullPath);
        const fileContent = await fs.readFile(fullPath, 'utf-8');
        // Mark this file as processed for this import chain
        const newImportState: ImportState = {
          ...importState,
          processedFiles: new Set(importState.processedFiles),
          currentDepth: importState.currentDepth + 1,
          currentFile: fullPath,
        };
        newImportState.processedFiles.add(fullPath);
        const imported = await processImports(
          fileContent,
          path.dirname(fullPath),
          debugMode,
          newImportState,
          projectRoot,
          importFormat,
          resourceRegistry,
        );
        result += `<!-- Imported from: ${importPath} -->\n${imported.content}\n<!-- End of import from: ${importPath} -->`;
        imports.push(imported.importTree);
      } catch (err: unknown) {
        let message = 'Unknown error';
        if (hasMessage(err)) {
          message = err.message;
        } else if (typeof err === 'string') {
          message = err;
        }
        logger.error(`Failed to import ${importPath}: ${message}`);
        result += `<!-- Import failed: ${importPath} - ${message} -->`;
      }
    } else if (importItem.type === 'resource') {
      // Handle MCP resource imports
      const { serverName, resourceUri } = importItem;
      const resourceKey = `${serverName}:${resourceUri}`;
      
      if (!resourceRegistry) {
        result += `<!-- Resource import failed: ${resourceKey} - MCP resource registry not available. Ensure MCP servers are configured and connected. -->`;
        continue;
      }

      // Check if resource is already processed (prevent circular imports)
      if (importState.processedFiles.has(resourceKey)) {
        result += `<!-- Resource already processed: ${resourceKey} -->`;
        continue;
      }

      // Check depth limit for resources
      if (importState.currentDepth >= importState.maxDepth) {
        result += `<!-- Resource import skipped: ${resourceKey} - Maximum import depth (${importState.maxDepth}) reached -->`;
        continue;
      }

      try {
        const resource = resourceRegistry.getResource(serverName, resourceUri);
        if (!resource) {
          // Check if server exists in registry to provide better error message
          const serverResources = resourceRegistry.getResourcesByServer(serverName);
          if (serverResources.length === 0) {
            result += `<!-- Resource import failed: ${resourceKey} - Server '${serverName}' not found or has no resources. Check MCP server configuration. -->`;
          } else {
            const availableUris = serverResources.map((r: any) => r.uri).slice(0, 5);
            const moreAvailable = serverResources.length > 5 ? ` and ${serverResources.length - 5} more` : '';
            result += `<!-- Resource import failed: ${resourceKey} - Resource not found. Available resources from '${serverName}': ${availableUris.join(', ')}${moreAvailable} -->`;
          }
          continue;
        }

        // Fetch resource content with timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Resource read timeout')), 30000)
        );
        const resourceContents = await Promise.race([
          resource.read(),
          timeoutPromise
        ]) as any;
        
        let resourceContent = '';
        const MAX_RESOURCE_SIZE = 10 * 1024 * 1024; // 10MB limit
        
        if ('text' in resourceContents && resourceContents.text) {
          resourceContent = resourceContents.text;
          if (resourceContent.length > MAX_RESOURCE_SIZE) {
            result += `<!-- Resource import failed: ${resourceKey} - Content too large (${Math.round(resourceContent.length / 1024 / 1024)}MB > 10MB limit) -->`;
            continue;
          }
        } else if ('blob' in resourceContents && resourceContents.blob) {
          // Handle binary content based on MIME type
          const mimeType = resourceContents.mimeType || 'application/octet-stream';
          
          if (mimeType.startsWith('text/') || 
              mimeType === 'application/json' ||
              mimeType === 'application/xml' ||
              mimeType.includes('markdown') ||
              mimeType.includes('yaml')) {
            // Attempt to decode as text for text-based MIME types
            try {
              const decodedBuffer = Buffer.from(resourceContents.blob, 'base64');
              if (decodedBuffer.length > MAX_RESOURCE_SIZE) {
                result += `<!-- Resource import failed: ${resourceKey} - Content too large (${Math.round(decodedBuffer.length / 1024 / 1024)}MB > 10MB limit) -->`;
                continue;
              }
              resourceContent = decodedBuffer.toString('utf-8');
            } catch (decodeError) {
              result += `<!-- Resource import failed: ${resourceKey} - Failed to decode ${mimeType} content as text -->`;
              continue;
            }
          } else {
            result += `<!-- Resource import skipped: ${resourceKey} - Binary content (${mimeType}) cannot be imported as text -->`;
            continue;
          }
        } else {
          result += `<!-- Resource import failed: ${resourceKey} - No text or blob content available -->`;
          continue;
        }

        // Mark this resource as processed for this import chain
        const newImportState: ImportState = {
          ...importState,
          processedFiles: new Set(importState.processedFiles),
          currentDepth: importState.currentDepth + 1,
          currentFile: resourceKey,
        };
        newImportState.processedFiles.add(resourceKey);

        // Process imports within the resource content (recursive)
        const imported = await processImports(
          resourceContent,
          basePath, // Resources don't have a file system path, use original basePath
          debugMode,
          newImportState,
          projectRoot,
          importFormat,
          resourceRegistry,
        );
        
        result += `<!-- Imported from resource: ${resourceKey} -->\n${imported.content}\n<!-- End of import from resource: ${resourceKey} -->`;
        imports.push(imported.importTree);
      } catch (err: unknown) {
        let message = 'Unknown error';
        if (hasMessage(err)) {
          message = err.message;
        } else if (typeof err === 'string') {
          message = err;
        }
        logger.error(`Failed to import resource ${resourceKey}: ${message}`);
        result += `<!-- Resource import failed: ${resourceKey} - ${message} -->`;
      }
    }
  }
  // Add any remaining content after the last match
  result += content.substring(lastIndex);

  return {
    content: result,
    importTree: {
      path: importState.currentFile || 'unknown',
      imports: imports.length > 0 ? imports : undefined,
    },
  };
}

export function validateImportPath(
  importPath: string,
  basePath: string,
  allowedDirectories: string[],
): boolean {
  // Reject URLs
  if (/^(file|https?):\/\//.test(importPath)) {
    return false;
  }

  const resolvedPath = path.resolve(basePath, importPath);

  return allowedDirectories.some((allowedDir) =>
    isSubpath(allowedDir, resolvedPath),
  );
}
