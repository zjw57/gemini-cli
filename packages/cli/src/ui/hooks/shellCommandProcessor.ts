/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryItemWithoutId } from '../types.js';
import type { exec as ExecType } from 'child_process';
import { useCallback } from 'react';
import { Config } from '@gemini-code/server';
import { type PartListUnion } from '@google/genai';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';
import pty from 'node-pty';

/**
 * Hook to process shell commands (e.g., !ls, $pwd).
 * Executes the command in the target directory and adds output/errors to history.
 */
export const useShellCommandProcessor = (
  addItemToHistory: UseHistoryManagerReturn['addItem'],
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  onExec: (command: Promise<void>) => void,
  onDebugMessage: (message: string) => void,
  config: Config,
  executeCommand?: typeof ExecType, // injectable for testing
) => {
  /**
   * Checks if the query is a shell command, executes it, and adds results to history.
   * @returns True if the query was handled as a shell command, false otherwise.
   */
  const handleShellCommand = useCallback(
    (rawQuery: PartListUnion): boolean => {
      if (typeof rawQuery !== 'string') {
        return false;
      }

      // wrap command to write pwd to temporary file
      let commandToExecute = rawQuery.trim();
      const pwdFileName = `shell_pwd_${crypto.randomBytes(6).toString('hex')}.tmp`;
      const pwdFilePath = path.join(os.tmpdir(), pwdFileName);
      if (!commandToExecute.endsWith('&')) commandToExecute += ';';
      // note here we could also restore a previous pwd with `cd {cwd}; { ... }`
      commandToExecute = `{ ${commandToExecute} }; __code=$?; pwd >${pwdFilePath}; exit $__code`;

      const userMessageTimestamp = Date.now();
      addItemToHistory(
        { type: 'user_shell', text: rawQuery },
        userMessageTimestamp,
      );

      if (rawQuery.trim() === '') {
        addItemToHistory(
          { type: 'error', text: 'Empty shell command.' },
          userMessageTimestamp,
        );
        return true; // Handled (by showing error)
      }

      const targetDir = config.getTargetDir();
      onDebugMessage(
        `Executing shell command in ${targetDir}: ${commandToExecute}`,
      );
      const execOptions = {
        cwd: targetDir,
      };

      const execPromise = new Promise<void>((resolve) => {
        if (executeCommand) {
          executeCommand(
            commandToExecute,
            execOptions,
            (error, stdout, stderr) => {
              if (error) {
                addItemToHistory(
                  {
                    type: 'error',
                    // remove wrapper from user's command in error message
                    text: error.message.replace(commandToExecute, rawQuery),
                  },
                  userMessageTimestamp,
                );
              } else {
                let output = '';
                if (stdout) output += stdout;
                if (stderr) output += (output ? '\n' : '') + stderr; // Include stderr as info

                addItemToHistory(
                  {
                    type: 'info',
                    text: output || '(Command produced no output)',
                  },
                  userMessageTimestamp,
                );
              }
              if (fs.existsSync(pwdFilePath)) {
                const pwd = fs.readFileSync(pwdFilePath, 'utf8').trim();
                if (pwd !== targetDir) {
                  addItemToHistory(
                    {
                      type: 'info',
                      text: `WARNING: shell mode is stateless; \`cd ${pwd}\` will not apply to next command`,
                    },
                    userMessageTimestamp,
                  );
                }
                fs.unlinkSync(pwdFilePath);
              }
              resolve();
            },
          );
        } else {
          const child = pty.spawn('bash', ['-c', commandToExecute], {
            name: 'xterm-color',
            cols: process.stdout.columns,
            rows: Math.min(20, process.stdout.rows),
            cwd: targetDir,
            env: process.env,
          });

          let output = '';
          child.onData((data: string) => {
            output += data;
            setPendingHistoryItem({ type: 'info', text: output });
          });

          const stdinListener = (data: Buffer) => {
            child.write(data.toString());
          };
          process.stdin.on('data', stdinListener);

          child.onExit(({ exitCode, signal }) => {
            process.stdin.removeListener('data', stdinListener);
            setPendingHistoryItem(null);

            output = output.trim() || '(Command produced no output)';
            if (exitCode !== 0) {
              const text = `Command exited with code ${exitCode}\n${output}`;
              addItemToHistory({ type: 'error', text }, userMessageTimestamp);
            } else if (signal) {
              const text = `Command terminated with signal ${signal}\n${output}`;
              addItemToHistory({ type: 'error', text }, userMessageTimestamp);
            } else {
              addItemToHistory(
                { type: 'info', text: output + '\n' },
                userMessageTimestamp,
              );
            }
            if (fs.existsSync(pwdFilePath)) {
              const pwd = fs.readFileSync(pwdFilePath, 'utf8').trim();
              if (pwd !== targetDir) {
                addItemToHistory(
                  {
                    type: 'info',
                    text: `WARNING: shell mode is stateless; \`cd ${pwd}\` will not apply to next command`,
                  },
                  userMessageTimestamp,
                );
              }
              fs.unlinkSync(pwdFilePath);
            }
            resolve();
          });
        }
      });

      try {
        onExec(execPromise);
      } catch (_e) {
        // silently ignore errors from this since it's from the caller
      }

      return true; // Command was initiated
    },
    [
      config,
      onDebugMessage,
      addItemToHistory,
      setPendingHistoryItem,
      onExec,
      executeCommand,
    ],
  );

  return { handleShellCommand };
};
