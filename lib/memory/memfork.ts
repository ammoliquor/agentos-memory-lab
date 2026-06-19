import { spawn } from 'child_process';
import * as path from 'path';
import * as fsSync from 'fs';
import { Commit } from '../types';

export type MemoryCommit = Commit;

function validateBranchName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('Branch name cannot be empty');
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9-_/]+$/.test(trimmed)) {
    throw new Error('Invalid branch name. Must be alphanumeric with hyphens or underscores.');
  }
}

async function runMemforkCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = process.env.MEMFORK_CLI_PATH;
    let executable: string;
    let spawnArgs: string[];

    if (cliPath) {
      const resolvedCliPath = path.resolve(cliPath);
      if (!fsSync.existsSync(resolvedCliPath)) {
        return reject(new Error('memfork executable not found'));
      }
      executable = 'node';
      spawnArgs = [resolvedCliPath, ...args];
    } else {
      executable = 'memfork';
      spawnArgs = args;
    }

    const child = spawn(executable, spawnArgs, {
      env: {
        ...process.env,
        MOCK_MEMFORK_SLEEP: process.env.MOCK_MEMFORK_SLEEP,
      },
      shell: false // Prevent command injection and process orphaning on Windows
    });

    let stdout = '';
    let stderr = '';

    const timeout = 10000; // 10 seconds timeout
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
      } else {
        child.kill();
      }
      reject(new Error('CLI execution timeout'));
    }, timeout);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const errMsg = stderr.trim() || stdout.trim();
        reject(new Error(`Memfork failed with code ${code}: ${errMsg}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err: any) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('memfork executable not found'));
      } else {
        reject(new Error(`Failed to initiate memfork CLI: ${err.message}`));
      }
    });
  });
}

export async function branch(name: string, from?: string): Promise<void> {
  validateBranchName(name);
  const trimmedName = name.trim();
  const args = ['branch', trimmedName];
  if (from) {
    validateBranchName(from);
    args.push('--from', from.trim());
  }
  await runMemforkCommand(args);
}

export async function commit(branchId: string, message: string, facts: string[]): Promise<Commit> {
  validateBranchName(branchId);
  if (!message || message.trim() === '') {
    throw new Error('Commit message cannot be empty');
  }

  const trimmedBranchId = branchId.trim();
  const args = ['commit', trimmedBranchId, '-m', message];
  if (facts && facts.length > 0) {
    args.push('--facts', ...facts);
  } else {
    args.push('--facts'); // Send an empty facts flag or handle empty facts
  }

  const response = await runMemforkCommand(args);
  try {
    return JSON.parse(response) as Commit;
  } catch (rawErr) {
    throw new Error(`Failed to parse commit response JSON: ${response}`);
  }
}

export async function recall(branchId: string): Promise<string[]> {
  validateBranchName(branchId);
  const trimmedBranchId = branchId.trim();
  const response = await runMemforkCommand(['recall', trimmedBranchId]);
  try {
    return JSON.parse(response) as string[];
  } catch (rawErr) {
    // Fallback split by lines if not JSON
    return response.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
  }
}
