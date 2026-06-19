# Milestone 1 Analysis: Core DB & CLI Wrapper

This report details the codebase environment analysis, database schema, CRUD helper planning, CLI wrapper planning, and test strategies for Milestone 1.

---

## 1. Development Tools & PATH Analysis

### 1.1 Investigation Log
- **Action**: Proactively attempted to inspect the path environment variables and query CLI versions (`node -v`, `npm -v`, etc.) via terminal command execution.
- **Result**: The permission prompt timed out due to the background, non-interactive execution environment.
- **Resolution**: Under the workflow guidelines, we assume a standard Node.js development environment.

### 1.2 Assumed Available Tools
Based on standard Next.js / TypeScript environments:
- **Runtime**: Node.js (version >= 18.x, preferably 20.x or higher)
- **Package Manager**: `npm` (bundled with Node.js), with `npx` for executing binaries, or alternatively `pnpm`/`yarn` depending on user project setup.
- **Compiler**: TypeScript (`tsc`) for compiling TS files and performing type verification.
- **Testing Runner**: Node.js built-in runner (`node:test` / `node:assert`) is selected as the default for zero-dependency test execution, but the environment may support Jest/Vitest if configured.

---

## 2. 'memfork' Executable Status

### 2.1 Investigation Log
- **Action**: Queried command path and help commands (`where.exe memfork`, `memfork --help`) via terminal runner.
- **Result**: Timed out due to permissions.
- **Diagnostic Outcome**: We must assume the native `memfork` binary is NOT globally installed or active by default, or may not exist on all target systems.

### 2.2 Dual-Mode Path Injection Strategy
To ensure the application functions correctly regardless of whether the native executable is present, we leverage the **Dual-Mode path injection strategy** defined in `TEST_INFRA.md`:
1. **Mock CLI Mode**: A Node.js CLI script `scripts/mock-memfork.js` is created to mimic `memfork`'s behavior directly.
2. **Path Resolution**: The wrapper checks `process.env.MEMFORK_CLI_PATH`.
   - If set, it runs `node <MEMFORK_CLI_PATH> <args>`.
   - If not set, it falls back to the system-wide executable `memfork <args>`.
3. **Database Integration**: Both modes propagate the database path via `process.env.MEMFORK_DB_PATH` to isolate test runs.

---

## 3. Analysis of PROJECT.md and SCOPE.md

### 3.1 Key Requirements
- **Next.js 15 App Router Layout**: Project is structured around `app/`, `components/`, `lib/`, `actions/`, and `hooks/`.
- **Milestone 1 Scope**: Focused strictly on:
  - Local JSON database `.memfork/db.json` setup and atomic helpers (`lib/db/db.ts`).
  - Memory Engine CLI wrapper (`lib/memory/memfork.ts`) with methods `branch`, `commit`, and `recall`.
  - Mock CLI executable (`scripts/mock-memfork.js`) to support E2E tests.
  - Basic testing infrastructure.
- **Environment Isolation**: Database operations must check `process.env.MEMFORK_DB_PATH` to ensure sandbox isolation during tests.

---

## 4. Database Schema Design for `.memfork/db.json`

The JSON database contains three primary top-level arrays: `branches`, `commits`, and `messages`. An additional array `mergeProposals` is included to support conflict tracking for future milestones.

### 4.1 TypeScript Interfaces (`lib/types/index.ts` or `lib/db/db.ts`)

```typescript
export interface DatabaseSchema {
  branches: Branch[];
  commits: Commit[];
  messages: Message[];
  mergeProposals: MergeProposal[];
}

export interface Branch {
  id: string;             // Unique identifier (e.g. "b_123" or slug "feature-alpha")
  name: string;           // Display/human-readable name
  parentBranchId: string | null; // ID of the branch this was forked from
}

export interface Commit {
  id: string;             // Unique identifier (e.g. "c_123")
  branchId: string;       // Target branch ID
  message: string;        // Commit message description
  facts: string[];        // Array of facts asserted in this commit
  parentCommit: string | null; // Parent commit ID in the DAG
  timestamp: number;      // Epoch timestamp (ms)
}

export interface Message {
  id: string;             // Unique message ID
  branchId: string;       // Associated branch context
  role: 'user' | 'assistant' | 'system';
  content: string;        // Text content
  agentType?: 'researcher' | 'critic' | 'builder' | null; // Agent identifier
  timestamp: number;      // Epoch timestamp (ms)
}

export interface MergeProposal {
  id: string;
  sourceBranchId: string;
  targetBranchId: string;
  status: 'CONFLICT' | 'RESOLVED';
  conflicts: string[];    // Contradictory facts or explanations
  timestamp: number;
}
```

---

## 5. Planning Atomic CRUD Database Helpers (`lib/db/db.ts`)

The database client must be thread-safe and protect against file corruption during concurrent operations.

### 5.1 Concurrency & Atomicity Strategy
1. **In-Process Lock/Queue**: All write operations are serialized using a global promise-based queue. This prevents race conditions where multiple async calls read outdated states before writing.
2. **Safe Write-and-Rename**: The file is written to a temporary file in the same directory (`.memfork/db.json.tmp`) and then renamed (`fs.promises.rename`) to the target path. On Windows and Unix, this is an atomic operation.
3. **Bootstrapping**: If the file does not exist, the client automatically creates the directory structure and writes a fresh, empty schema `{ branches: [], commits: [], messages: [], mergeProposals: [] }`.

### 5.2 Helper Signatures & Flow Logic

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

// Get target DB path checking environment variables
export function getDbPath(): string {
  if (process.env.MEMFORK_DB_PATH) {
    return path.resolve(process.env.MEMFORK_DB_PATH);
  }
  return path.resolve('.memfork/db.json');
}

// Read database and bootstrap if missing
export async function readDb(): Promise<DatabaseSchema> {
  const dbPath = getDbPath();
  try {
    const data = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(data) as DatabaseSchema;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
      await writeDb(defaultDb);
      return defaultDb;
    }
    // Backup corrupt file and re-initialize
    console.error(`Corrupt database file found. Backing up and resetting. Error: ${error.message}`);
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    try {
      await fs.rename(dbPath, backupPath);
    } catch {}
    const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
    await writeDb(defaultDb);
    return defaultDb;
  }
}

// Global promise chain to serialize writes
let writeQueue = Promise.resolve();

export async function writeDb(db: DatabaseSchema): Promise<void> {
  return new Promise((resolve, reject) => {
    writeQueue = writeQueue.then(async () => {
      const dbPath = getDbPath();
      const tempPath = `${dbPath}.tmp`;
      try {
        await fs.mkdir(path.dirname(dbPath), { recursive: true });
        await fs.writeFile(tempPath, JSON.stringify(db, null, 2), 'utf8');
        await fs.rename(tempPath, dbPath);
        resolve();
      } catch (err) {
        reject(err);
      }
    }).catch(reject);
  });
}

// Entity-Specific CRUD Wrappers
export async function getBranches(): Promise<Branch[]> {
  const db = await readDb();
  return db.branches;
}

export async function addBranch(branch: Branch): Promise<void> {
  const db = await readDb();
  if (db.branches.some(b => b.name === branch.name)) {
    throw new Error(`Branch with name "${branch.name}" already exists`);
  }
  db.branches.push(branch);
  await writeDb(db);
}

export async function getCommits(branchId?: string): Promise<Commit[]> {
  const db = await readDb();
  if (branchId) {
    return db.commits.filter(c => c.branchId === branchId);
  }
  return db.commits;
}

export async function addCommit(commit: Commit): Promise<void> {
  const db = await readDb();
  db.commits.push(commit);
  await writeDb(db);
}

export async function getMessages(branchId?: string): Promise<Message[]> {
  const db = await readDb();
  if (branchId) {
    return db.messages.filter(m => m.branchId === branchId);
  }
  return db.messages;
}

export async function addMessage(message: Message): Promise<void> {
  const db = await readDb();
  db.messages.push(message);
  await writeDb(db);
}
```

---

## 6. Planning CLI Wrappers (`lib/memory/memfork.ts`)

The wrappers map TypeScript function signatures to `child_process` calls.

### 6.1 Generic CLI Spawner

```typescript
import { spawn } from 'child_process';
import * as path from 'path';
import { Commit } from '../db/db';

async function runMemforkCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = process.env.MEMFORK_CLI_PATH;
    let executable: string;
    let spawnArgs: string[];

    if (cliPath) {
      executable = 'node';
      spawnArgs = [path.resolve(cliPath), ...args];
    } else {
      executable = 'memfork';
      spawnArgs = args;
    }

    // Windows compatibility shell flag
    const child = spawn(executable, spawnArgs, {
      env: { ...process.env },
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Memfork failed with code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to initiate memfork CLI: ${err.message}`));
    });
  });
}
```

### 6.2 Implementation of Core Wrappers

- **`branch(name: string, from?: string): Promise<void>`**
  Creates a branch in the DAG.
  ```typescript
  export async function branch(name: string, from?: string): Promise<void> {
    if (!name || name.trim() === '') {
      throw new Error('Branch name cannot be empty');
    }
    const args = ['branch', name];
    if (from) {
      args.push('--from', from);
    }
    await runMemforkCommand(args);
  }
  ```

- **`commit(branchId: string, message: string, facts: string[]): Promise<Commit>`**
  Commits facts to a specific branch.
  ```typescript
  export async function commit(branchId: string, message: string, facts: string[]): Promise<Commit> {
    if (!branchId || branchId.trim() === '') {
      throw new Error('Branch ID cannot be empty');
    }
    if (!message || message.trim() === '') {
      throw new Error('Commit message cannot be empty');
    }
    
    // We design the CLI to accept branchId, message, and facts
    const args = ['commit', branchId, '-m', message];
    if (facts.length > 0) {
      args.push('--facts', ...facts);
    }
    
    const response = await runMemforkCommand(args);
    try {
      return JSON.parse(response) as Commit;
    } catch {
      throw new Error(`Failed to parse commit response JSON: ${response}`);
    }
  }
  ```

- **`recall(branchId: string): Promise<string[]>`**
  Recalls aggregated facts along the branch's ancestry.
  ```typescript
  export async function recall(branchId: string): Promise<string[]> {
    if (!branchId || branchId.trim() === '') {
      throw new Error('Branch ID cannot be empty');
    }
    const response = await runMemforkCommand(['recall', branchId]);
    try {
      return JSON.parse(response) as string[];
    } catch {
      // Fallback if returned in raw newline format
      return response.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
    }
  }
  ```

---

## 7. Unit and Integration Test Strategies

We will use Node.js's built-in `node:test` framework and assertion library (`node:assert`) to test all core functionality.

### 7.1 Unit Testing Strategy
- **`lib/db/db.ts` Unit Tests**:
  - Mock the filesystem (`fs/promises`) using Jest-like mocks, or write to a dedicated local sandbox file (e.g. `.memfork/test-env/db.unit.json`) and run assertions.
  - Verify initialization (bootstrapping when file is absent).
  - Verify concurrent writes: Spawn 10 simultaneous asynchronous calls appending records, and assert that the file contents are fully written, in-order, and uncorrupted.
  - Verify error handling on corrupt JSON files.
- **`lib/memory/memfork.ts` Unit Tests**:
  - Verify parameter validation (empty strings, null arguments throw errors before spawning).
  - Verify command formatting (ensures `--from` is correctly populated, facts list is mapped).

### 7.2 Integration Testing Strategy
Integration tests will verify the wrapper interacts correctly with the mock CLI and the database sandbox.
- **Sandbox Manager (`tests/helpers/db-sandbox.js`)**:
  - Before each suite: Creates `.memfork/test-env/` and sets `process.env.MEMFORK_DB_PATH = path.resolve('.memfork/test-env/db.test.json')`.
  - Sets `process.env.MEMFORK_CLI_PATH = path.resolve('scripts/mock-memfork.js')`.
  - After each suite: Deletes the test-env folder.
- **E2E Feature Verification (`tests/e2e/tier1_feature.test.js`)**:
  - Branch creation: Invoke `branch("feature-x")`, verify it writes a branch object to `db.test.json`.
  - Forking: Invoke `branch("feature-y", "feature-x")`, verify the `parentBranchId` is set to `"feature-x"`'s ID.
  - Commits: Invoke `commit("feature-x", "Init", ["A", "B"])`. Verify a commit entry is created in the database, with parent set to null.
  - Recall Ancestry: Commit `"C"` to `"feature-y"`. Run `recall("feature-y")`. Assert that the returned array is `["A", "B", "C"]`.

---

## 8. Development Setup & Config Configuration Plan

To launch the Next.js 15 template and compile TypeScript, we need to create or configure the following setup files:

### 8.1 Required Configuration Files
1. **`package.json`**:
   - Standard dependencies: `next@15`, `react@19`, `react-dom@19`, `typescript`, `reactflow` (for DAG), `@tailwindcss/postcss`, `tailwindcss`, `lucide-react`.
   - Scripts to define:
     - `"dev"`: `"next dev"`
     - `"build"`: `"next build"`
     - `"verify"`: `"node scripts/verify-project.js"`
2. **`tsconfig.json`**:
   - Configures TS module resolution, App Router settings, and path alias mapping (e.g., `@/*` maps to `./*`).
3. **`postcss.config.mjs` / `tailwind.config.ts`**:
   - Standard configuration to bundle Tailwind CSS.
4. **`.gitignore`**:
   - Must ignore `.next/`, `node_modules/`, and the local state directories (excluding metadata):
     ```text
     node_modules/
     .next/
     .memfork/
     !.memfork/db.json
     .memfork/test-env/
     *.tmp
     ```

This wraps up the comprehensive environment and planning investigation.
