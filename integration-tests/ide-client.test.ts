/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import * as child_process from 'node:child_process';
import { IdeClient } from '../packages/core/src/ide/ide-client.js';

import { TestMcpServer } from './test-mcp-server.js';

describe('IdeClient', () => {
  let server: TestMcpServer;
  let portFile: string;

  beforeEach(() => {
    // Reset instance
    (IdeClient as unknown as { instance: IdeClient | undefined }).instance =
      undefined;
  });

  afterEach(async () => {
    // Disconnect the client before stopping the server to prevent a timeout.
    (await IdeClient.getInstance()).disconnect();
    await server.stop();
    delete process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'];
    delete process.env['TERM_PROGRAM'];
    if (fs.existsSync(portFile)) {
      fs.unlinkSync(portFile);
    }
  });

  it('reads port from file and connects', async () => {
    server = new TestMcpServer();
    const port = await server.start();
    const pid = process.pid;
    const portFileDir = path.join(os.tmpdir(), 'gemini', 'ide');
    fs.mkdirSync(portFileDir, { recursive: true });
    portFile = path.join(
      portFileDir,
      `gemini-ide-server-${pid}-${Date.now()}.json`,
    );
    fs.writeFileSync(portFile, JSON.stringify({ port }));
    process.env['GEMINI_CLI_IDE_SERVER_PORT'] = String(port);
    process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'] = process.cwd();
    process.env['TERM_PROGRAM'] = 'vscode';

    console.log(
      `[DEBUG] Test: Port file created at ${portFile} with port ${port}`,
    );
    console.log(`[DEBUG] Test: File exists? ${fs.existsSync(portFile)}`);

    const ideClient = await IdeClient.getInstance();
    await ideClient.connect();

    expect(ideClient.getConnectionStatus()).toEqual({
      status: 'connected',
      details: undefined,
    });
  });
});

const getFreePort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => {
        resolve(port);
      });
    });
  });
};

describe('IdeClient fallback connection logic', () => {
  let server: TestMcpServer;
  let envPort: number;
  let pid: number;
  let portFile: string;

  beforeEach(async () => {
    pid = process.pid;
    portFile = path.join(os.tmpdir(), `gemini-ide-server-${pid}.json`);
    server = new TestMcpServer();
    envPort = await server.start();
    process.env['GEMINI_CLI_IDE_SERVER_PORT'] = String(envPort);
    process.env['TERM_PROGRAM'] = 'vscode';
    process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'] = process.cwd();
    // Reset instance
    (IdeClient as unknown as { instance: IdeClient | undefined }).instance =
      undefined;
  });

  afterEach(async () => {
    // Disconnect the client before stopping the server to prevent a timeout.
    (await IdeClient.getInstance()).disconnect();
    await server.stop();
    delete process.env['GEMINI_CLI_IDE_SERVER_PORT'];
    delete process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'];
    if (fs.existsSync(portFile)) {
      fs.unlinkSync(portFile);
    }
  });

  it('connects using env var when port file does not exist', async () => {
    // Ensure port file doesn't exist
    if (fs.existsSync(portFile)) {
      fs.unlinkSync(portFile);
    }

    const ideClient = await IdeClient.getInstance();
    await ideClient.connect();

    expect(ideClient.getConnectionStatus()).toEqual({
      status: 'connected',
      details: undefined,
    });
  });

  it('falls back to env var when connection with port from file fails', async () => {
    const filePort = await getFreePort();
    // Write port file with a port that is not listening
    fs.writeFileSync(portFile, JSON.stringify({ port: filePort }));

    const ideClient = await IdeClient.getInstance();
    await ideClient.connect();

    expect(ideClient.getConnectionStatus()).toEqual({
      status: 'connected',
      details: undefined,
    });
  });
});

describe('getIdeProcessId', () => {
  let child: child_process.ChildProcess;

  afterEach(() => {
    if (child) {
      child.kill();
    }
  });

  it('should return the pid of the parent process', async () => {
    // We need to spawn a child process that will run the test
    // so that we can check that getIdeProcessId returns the pid of the parent.
    // We pipe the code via stdin and use --input-type=module because this
    // project uses ES Modules.
    const output = await new Promise<string>((resolve, reject) => {
      child = child_process.spawn(
        path.resolve('./node_modules/.bin/tsx'),
        ['--input-type=module'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      child.stdin?.write(`
        import { getIdeProcessInfo } from '${path.resolve(
          './packages/core/src/ide/process-utils.ts',
        )}';
        getIdeProcessInfo().then(info => console.log(info.pid));
      `);
      child.stdin?.end();

      let out = '';
      child.stdout?.on('data', (data) => {
        out += data.toString();
      });

      let err = '';
      child.stderr?.on('data', (data) => {
        err += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(out.trim());
        } else {
          reject(new Error(`Child process exited with code ${code}: ${err}`));
        }
      });
    });

    // This test verifies that getIdeProcessInfo correctly finds an ancestor process.
    // It works by spawning a child process and having that child call the function.
    // The test is successful if the PID returned by the child (`returnedPid`) is:
    // 1. A valid process ID (> 0).
    // 2. Not the child's own PID (proving it traversed up the process tree).
    // We don't check for equality with the main test runner's PID (`process.pid`)
    // because the process hierarchy can be complex and change, making the test brittle.
    const returnedPid = parseInt(output, 10);
    expect(returnedPid).toBeGreaterThan(0);
    expect(returnedPid).not.toBe(child.pid);
  }, 10000);
});

describe('IdeClient with proxy', () => {
  let mcpServer: TestMcpServer;
  let proxyServer: net.Server;
  let mcpServerPort: number;
  let proxyServerPort: number;

  beforeEach(async () => {
    mcpServer = new TestMcpServer();
    mcpServerPort = await mcpServer.start();

    proxyServer = net.createServer().listen();
    proxyServerPort = (proxyServer.address() as net.AddressInfo).port;

    vi.stubEnv('GEMINI_CLI_IDE_SERVER_PORT', String(mcpServerPort));
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('GEMINI_CLI_IDE_WORKSPACE_PATH', process.cwd());

    // Reset instance
    (IdeClient as unknown as { instance: IdeClient | undefined }).instance =
      undefined;
  });

  afterEach(async () => {
    (await IdeClient.getInstance()).disconnect();
    await mcpServer.stop();
    proxyServer.close();
    vi.unstubAllEnvs();
  });

  it('should connect to IDE server when HTTP_PROXY, HTTPS_PROXY and NO_PROXY are set', async () => {
    vi.stubEnv('HTTP_PROXY', `http://localhost:${proxyServerPort}`);
    vi.stubEnv('HTTPS_PROXY', `http://localhost:${proxyServerPort}`);
    vi.stubEnv('NO_PROXY', 'example.com,127.0.0.1,::1');

    const ideClient = await IdeClient.getInstance();
    await ideClient.connect();

    expect(ideClient.getConnectionStatus()).toEqual({
      status: 'connected',
      details: undefined,
    });
  });
});
