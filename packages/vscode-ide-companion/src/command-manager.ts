/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { type JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';
import { ChildProcess, spawn } from 'node:child_process';
import { multiplex } from './utils/multiplex.js';

interface CommandInfo {
  command: string;
  terminal: vscode.Terminal;
  outputFile?: string;
  process: ChildProcess;
}

/**
 * Manages running commands in the integrated terminal.
 */
export class CommandManager {
  private readonly onDidChangeEmitter =
    new vscode.EventEmitter<JSONRPCNotification>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly runningCommands = new Map<string, CommandInfo>();
  private readonly terminalName = 'Gemini Tasks';

  constructor(private readonly logger: vscode.OutputChannel) {}

  private findExistingTerminal(): vscode.Terminal | undefined {
    return vscode.window.terminals.find((t) => t.name === this.terminalName);
  }
  async runCommand(command: string, outputFile?: string) {
    // First, find and dispose of any existing terminal with the same name,
    // regardless of whether it's in the panel or editor area.
    const existingTerminal = vscode.window.terminals.find(
      (t) => t.name === this.terminalName,
    );
    if (existingTerminal) {
      existingTerminal.dispose();
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        this.logger.appendLine(`Terminal opened for command: ${command}`);
        this.runProcess(command, writeEmitter, outputFile);
      },
      close: () => {
        const commandInfo = this.runningCommands.get(command);
        if (commandInfo) {
          commandInfo.process.kill();
        }
      },
    };

    // --- KEY CHANGE IS HERE ---
    // Define options to open the terminal in a split view in the editor area.
    const terminalOptions: vscode.ExtensionTerminalOptions = {
      name: this.terminalName,
      pty,
      location: {
        viewColumn: vscode.ViewColumn.Beside, // This forces a split view
        preserveFocus: false,
      },
    };
    // --- END OF KEY CHANGE ---

    const terminal = vscode.window.createTerminal(terminalOptions);
    terminal.show();
  }

  private runProcess(
    command: string,
    writeEmitter: vscode.EventEmitter<string>,
    outputFile?: string,
  ) {
    const [executable, ...args] = command.split(' ');
    const process = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      this.logger.appendLine(
        `Failed to get active terminal for command: ${command}`,
      );
      return;
    }

    this.runningCommands.set(command, {
      command,
      terminal,
      outputFile,
      process,
    });

    const destinations: Array<(data: string) => void> = [
      (data) => writeEmitter.fire(data.replace(/\n/g, '\r\n')),
      (data) => this.handleOutput(command, data),
    ];

    if (outputFile) {
      destinations.push((data: string) => {
        vscode.workspace.fs.writeFile(
          vscode.Uri.file(outputFile),
          Buffer.from(data),
        );
      });
    }

    const stream = multiplex(...destinations);

    process.stdout.on('data', (data: Buffer) => {
      stream.write(data.toString());
    });

    process.stderr.on('data', (data: Buffer) => {
      stream.write(data.toString());
    });

    process.on('close', (code) => {
      const exitMessage = `\r\nCommand finished with exit code ${code}\r\n`;
      writeEmitter.fire(exitMessage);
      this.handleClose(command, code);
    });

    this.onDidChangeEmitter.fire({
      jsonrpc: '2.0',
      method: 'ide/commandStarted',
      params: {
        command,
      },
    });
  }

  private handleOutput(command: string, data: string) {
    this.onDidChangeEmitter.fire({
      jsonrpc: '2.0',
      method: 'ide/commandOutput',
      params: {
        command,
        output: data,
      },
    });
  }

  private handleClose(command: string, code: number | null) {
    const commandInfo = this.runningCommands.get(command);
    if (commandInfo) {
      this.runningCommands.delete(command.trim());
      this.onDidChangeEmitter.fire({
        jsonrpc: '2.0',
        method: 'ide/commandFinished',
        params: {
          command,
          exitCode: code,
        },
      });
    }
  }
}
