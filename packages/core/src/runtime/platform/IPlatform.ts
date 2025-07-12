/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An interface that abstracts away host-specific capabilities, such as file system
 * access and path manipulation. This allows the core runtime to remain platform-agnostic.
 */
export interface IPlatform {
  /**
   * Reads the content of a file at a given path.
   * @param path The path to the file.
   * @returns A promise that resolves with the file content as a UTF-8 string.
   * @throws An error if the file does not exist or cannot be read.
   */
  readFile(path: string): Promise<string>;

  /**
   * Writes content to a file at a given path, creating directories if necessary.
   * @param path The path to the file.
   * @param content The content to write.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Removes a file or directory.
   * @param path The path to remove.
   */
  rm(path: string): Promise<void>;

  /**
   * Returns the user's home directory path.
   */
  getHomeDir(): string;

  /**
   * Joins all given path segments together using the platform-specific separator.
   * @param paths A sequence of path segments.
   */
  joinPath(...paths: string[]): string;
}