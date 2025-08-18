/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

export interface IDEProcess {
  pid: number;
  command: string;
}

/**
 * Traverses up the process tree to find the top-level ancestor process and its command.
 * This is useful for identifying the main application process that spawned the current script,
 * such as the main VS Code window process.
 *
 * @returns A promise that resolves to an object containing the PID and command of the top-level process.
 * @throws Will throw an error if the underlying shell commands fail unexpectedly.
 */
export async function getIdeProcessInfo(): Promise<IDEProcess> {
  const platform = os.platform();
  let currentPid = process.pid;

  // Loop upwards through the process tree, with a depth limit to prevent infinite loops.
  const MAX_TRAVERSAL_DEPTH = 32;
  for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i++) {
    let parentPid: number;

    try {
      // Use wmic for Windows
      if (platform === 'win32') {
        const command = `wmic process where "ProcessId=${currentPid}" get ParentProcessId /value`;
        const { stdout } = await execAsync(command);
        const match = stdout.match(/ParentProcessId=(\d+)/);
        parentPid = match ? parseInt(match[1], 10) : 0; // Top of the tree is 0
      }
      // Use ps for macOS, Linux, and other Unix-like systems
      else {
        const command = `ps -o ppid= -p ${currentPid}`;
        const { stdout } = await execAsync(command);
        const ppid = parseInt(stdout.trim(), 10);
        parentPid = isNaN(ppid) ? 1 : ppid; // Top of the tree is 1
      }
    } catch (_) {
      // This can happen if a process in the chain dies during execution.
      // We'll break the loop and return the last valid PID we found.
      break;
    }

    // Define the root PID for the current OS
    const rootPid = platform === 'win32' ? 0 : 1;

    // If the parent is the root process or invalid, we've found our target.
    if (parentPid === rootPid || parentPid <= 0) {
      break;
    }
    // Move one level up the tree for the next iteration.
    currentPid = parentPid;
  }

  // Now get the command for the top-level PID we found.
  let command = '';
  try {
    if (platform === 'win32') {
      const cmd = `wmic process where "ProcessId=${currentPid}" get CommandLine /value`;
      const { stdout } = await execAsync(cmd);
      const match = stdout.match(/CommandLine=(.*)/);
      command = match ? match[1].trim() : '';
    } else {
      const cmd = `ps -o command= -p ${currentPid}`;
      const { stdout } = await execAsync(cmd);
      command = stdout.trim();
    }
  } catch (_) {
    // Ignore errors here, we'll just return an empty command.
  }

  return { pid: currentPid, command };
}
