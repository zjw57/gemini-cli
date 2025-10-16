/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Script to deflake tests
// Ex. npm run deflake -- --command="npm run test:e2e -- --test-name-pattern 'extension'" --runs=3

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dockerIgnorePath = path.join(projectRoot, '.dockerignore');

const DOCKERIGNORE_CONTENT = `.integration-tests`.trim();

/**
 * Runs a command and streams its output to the console.
 * @param {string} command The command string to execute (e.g., 'npm run test:e2e -- --watch').
 * @returns {Promise<number>} A Promise that resolves with the exit code of the process.
 */
function runCommand(cmd, args = []) {
  if (!cmd) {
    return Promise.resolve(1);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', (code) => {
      resolve(code ?? 1); // code can be null if the process was killed
    });

    child.on('error', (err) => {
      // An error occurred in spawning the process (e.g., command not found).
      console.error(`Failed to start command: ${err.message}`);
      reject(err);
    });
  });
}
// -------------------------------------------------------------------

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('command', {
      type: 'string',
      demandOption: true,
      description: 'The command to run',
    })
    .option('runs', {
      type: 'number',
      default: 5,
      description: 'The number of runs to perform',
    }).argv;

  const NUM_RUNS = argv.runs;
  const COMMAND = argv.command;
  const ARGS = argv._;
  let failures = 0;

  let createdDockerIgnore = false;

  console.log(`--- Starting Deflake Run (${NUM_RUNS} iterations) ---`);

  try {
    try {
      // Check if it exists first to avoid overwriting
      await fs.access(dockerIgnorePath);
    } catch {
      console.log(
        'Creating temporary .dockerignore to exclude .integration-tests...',
      );
      await fs.writeFile(dockerIgnorePath, DOCKERIGNORE_CONTENT);
      createdDockerIgnore = true;
    }

    for (let i = 1; i <= NUM_RUNS; i++) {
      console.log(`\n[RUN ${i}/${NUM_RUNS}]`);

      try {
        // 3. Await the asynchronous command run
        const exitCode = await runCommand(COMMAND, ARGS);

        if (exitCode === 0) {
          console.log('✅ Run PASS');
        } else {
          console.log(`❌ Run FAIL (Exit Code: ${exitCode})`);
          failures++;
        }
      } catch (error) {
        console.error('❌ Run FAIL (Execution Error)', error);
        failures++;
      }
    }
  } finally {
    if (createdDockerIgnore) {
      console.log('Cleaning up temporary .dockerignore...');
      try {
        await fs.unlink(dockerIgnorePath);
      } catch (e) {
        console.error('Failed to delete temporary .dockerignore:', e);
      }
    }
  }

  console.log('\n--- FINAL DEFLAKE SUMMARY ---');
  console.log(`Total Runs: ${NUM_RUNS}`);
  console.log(`Total Failures: ${failures}`);

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error in deflake:', error);
  process.exit(1);
});
