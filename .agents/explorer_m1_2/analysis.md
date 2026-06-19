# Milestone 1: Core DB & CLI Wrapper - Requirements & Design Analysis

## Executive Summary
This report analyzes the development environment, codebase specifications, database schema, database CRUD helper, CLI wrapper, and testing architecture for Milestone 1 of the **AgentOS Memory Lab**. Due to security restrictions in the execution environment, terminal tool verification was simulated and resolved using design assumptions. We propose a robust file-based schema, atomic queue helpers, dual-mode path injection, and an isolated E2E testing framework to fulfill the requirements of Milestone 1.

---

## 1. Development Environment & PATH Tools

### 1.1 Terminal Environment Check
- **Observation**: Terminal execution via `run_command` timed out during tool checks (e.g. `node --version` and `where memfork`), indicating that interactive permission approval is required but timed out.
- **Resolution**: We assume a standard Node.js development environment.
- **Assumed Tools**:
  - **Node.js**: Version `20.x` or higher (compatible with Next.js 15).
  - **Package Manager**: `npm` (v10.x+) or `pnpm` (v9.x+) for managing dependencies.
  - **TypeScript Compiler**: `tsc` (v5.x+) for type verification and build-time checking.
  - **Testing framework**: `vitest` (v2.x) or Jest for test assertions and runners.

---

## 2. 'memfork' CLI Executable Availability & Strategy

### 2.1 Availability
- Since direct system commands are inaccessible, we must assume the native `memfork` executable is **not globally installed** on the host environment by default, or its availability is unreliable across developer platforms (e.g., Windows vs macOS vs Linux).

### 2.2 Path Injection Strategy
To ensure system independence and support mock execution during testing, the CLI wrapper in `lib/memory/memfork.ts` will implement a **dual-mode path resolution strategy**:
1. **Fallback Path Injection**: Check `process.env.MEMFORK_CLI_PATH`.
   - If `MEMFORK_CLI_PATH` is set, execute `node <MEMFORK_CLI_PATH> <args>` using `child_process.spawn`/`execFile`.
   - If `MEMFORK_CLI_PATH` is undefined, execute `memfork <args>` directly on the system PATH.
2. **Environment DB Propagation**: Propagate `process.env.MEMFORK_DB_PATH` to the spawned process's env variables. This enables the mock CLI (`scripts/mock-memfork.js`) to target the correct database sandbox.

---

## 3. Analysis of PROJECT.md and SCOPE.md

### 3.1 Architectural Layout
Per `PROJECT.md`, the AgentOS Memory Lab is built on:
- **Framework**: Next.js 15 (App Router), React 19, Tailwind CSS, TypeScript, shadcn/ui.
- **Memory Engine**: Child process execution of the `memfork` CLI.
- **State Persistence**: A single local JSON file at `.memfork/db.json` (redirectable via `MEMFORK_DB_PATH`).

### 3.2 Milestone 1 Objectives
Per `sub_orch_m1/SCOPE.md`, the scope for Milestone 1 includes:
1. **Database Schema & Helpers**: Establishing the layout of `.memfork/db.json` and writing CRUD helpers in `lib/db/db.ts`.
2. **Memfork CLI Wrapper**: Creating `lib/memory/memfork.ts` to execute `branch`, `commit`, and `recall` commands via child processes.
3. **Core Integration & Unit Tests**: Implementing tests to verify DB serialization, concurrency safety, and CLI execution accuracy.

---

## 4. Schema Design for `.memfork/db.json`

The local database persists the memory DAG, agent messages, and branch history. We propose a normalized JSON layout split into three core tables: `branches`, `commits`, and `messages`, plus `mergeProposals` for conflict tracking in future milestones.

### 4.1 TypeScript Definitions (`lib/types/db.ts`)
```typescript
export interface Branch {
  id: string;                  // Unique identifier (slugified name or UUID)
  name: string;                // Display name (e.g., "main", "research-timescaledb")
  parentBranchId: string | null; // Parent branch reference (null for initial root)
  createdAt: string;           // ISO 8601 timestamp
}

export interface MemoryCommit {
  id: string;                  // Unique commit hash or ID (e.g., "c_12345")
  branchId: string;            // Reference to the branch this commit belongs to
  message: string;             // Human-readable change message
  facts: string[];             // Core facts stored/asserted in this commit
  parentCommitId: string | null; // ID of the parent commit in the branch DAG
  timestamp: string;           // ISO 8601 timestamp
}

export interface ChatMessage {
  id: string;                  // Unique message ID
  branchId: string;            // The branch context the conversation is running on
  role: 'user' | 'assistant' | 'system';
  content: string;             // Text payload
  agentType?: 'researcher' | 'critic' | 'builder' | null; // Which specialist generated the message
  timestamp: string;           // ISO 8601 timestamp
}

export interface MergeProposal {
  id: string;
  sourceBranchId: string;
  targetBranchId: string;
  status: 'CONFLICT' | 'RESOLVED';
  conflicts: string[];          // List of contradictory facts/explanations
  timestamp: string;            // ISO 8601 timestamp
}

export interface DatabaseSchema {
  branches: Branch[];
  commits: MemoryCommit[];
  messages: ChatMessage[];
  mergeProposals: MergeProposal[];
}
```

### 4.2 Mock Database JSON Example
```json
{
  "branches": [
    {
      "id": "main",
      "name": "main",
      "parentBranchId": null,
      "createdAt": "2026-06-18T22:00:00.000Z"
    },
    {
      "id": "db-research",
      "name": "db-research",
      "parentBranchId": "main",
      "createdAt": "2026-06-18T22:05:00.000Z"
    }
  ],
  "commits": [
    {
      "id": "c_1",
      "branchId": "main",
      "message": "Initial constraints commit",
      "facts": [
        "Relational databases use SQL.",
        "System must process 10,000 rps."
      ],
      "parentCommitId": null,
      "timestamp": "2026-06-18T22:01:00.000Z"
    },
    {
      "id": "c_2",
      "branchId": "db-research",
      "message": "Add TimescaleDB details",
      "facts": [
        "TimescaleDB extends PostgreSQL.",
        "TimescaleDB provides automatic partitioning."
      ],
      "parentCommitId": "c_1",
      "timestamp": "2026-06-18T22:06:00.000Z"
    }
  ],
  "messages": [
    {
      "id": "m_1",
      "branchId": "main",
      "role": "user",
      "content": "What database should we select for time-series scaling?",
      "timestamp": "2026-06-18T22:00:30.000Z"
    }
  ],
  "mergeProposals": []
}
```

---

## 5. Design of Atomic Database CRUD Helpers (`lib/db/db.ts`)

The database module must operate safely when accessed concurrently by parallel web server requests and child processes executing mock CLI calls.

### 5.1 Concurrency & Atomicity Strategy
1. **Dynamic Path Resolution**: Resolve target file using `process.env.MEMFORK_DB_PATH` with a fallback to `./.memfork/db.json`.
2. **Bootstrapping**: Upon initialization, if the target directory or file does not exist, build the directory structure and initialize with an empty schema `{ branches: [], commits: [], messages: [], mergeProposals: [] }`.
3. **Atomic File Write (Write-and-Rename)**: To avoid file truncation or half-writes during disk failures or process interruptions, writes must be written to a temporary file (`.memfork/db.json.tmp`) and then renamed (`fs.promises.rename`) over the target database file.
4. **Promise Write Serialization Queue**: Manage in-process writes via a serialized promise queue, guaranteeing that no two async tasks write to the database file out-of-order or mid-read.
5. **Corruption Recovery**: If the database file is read but cannot be parsed as JSON, the system should catch the error, copy/rename the corrupt file to `<path>.corrupt.<timestamp>` for debug tracing, and write a fresh, valid schema file.

### 5.2 Planned Helper API Signature
```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

// Lock/Queue variable
let writeQueue = Promise.resolve();

export function getDbPath(): string {
  return process.env.MEMFORK_DB_PATH 
    ? path.resolve(process.env.MEMFORK_DB_PATH) 
    : path.resolve('.memfork/db.json');
}

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
    // Handle JSON Corruption
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    try { await fs.rename(dbPath, backupPath); } catch {}
    const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
    await writeDb(defaultDb);
    return defaultDb;
  }
}

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

// Database Entity Modifiers
export async function getBranches(): Promise<Branch[]>;
export async function addBranch(branch: Branch): Promise<void>;
export async function getCommits(branchId?: string): Promise<MemoryCommit[]>;
export async function addCommit(commit: MemoryCommit): Promise<void>;
export async function getMessages(branchId?: string): Promise<ChatMessage[]>;
export async function addMessage(message: ChatMessage): Promise<void>;
```

---

## 6. Design of CLI Wrapper (`lib/memory/memfork.ts`)

The CLI wrapper maps structural TypeScript function calls to sub-process shells invoking the `memfork` command-line executable.

### 6.1 Generic Execution Core
```typescript
import { spawn } from 'child_process';
import * as path from 'path';

async function runCliCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = process.env.MEMFORK_CLI_PATH;
    let cmd: string;
    let spawnArgs: string[];

    if (cliPath) {
      cmd = 'node';
      spawnArgs = [path.resolve(cliPath), ...args];
    } else {
      cmd = 'memfork';
      spawnArgs = args;
    }

    const child = spawn(cmd, spawnArgs, {
      env: { ...process.env },
      shell: process.platform === 'win32' // Ensure compatibility on Windows shells
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`CLI Execution failed with exit code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn memfork executable: ${err.message}`));
    });
  });
}
```

### 6.2 Implementation Signatures

- **`branch(name: string, from?: string): Promise<void>`**
  - Validation: Verify `name` is a non-empty alphanumeric string.
  - Shell Call: `memfork branch <name> [--from <from>]`
  - Purpose: Signals the memory manager to fork a new branch in the DAG.
  ```typescript
  export async function branch(name: string, from?: string): Promise<void> {
    if (!name || name.trim() === '') throw new Error('Branch name is required.');
    const args = ['branch', name];
    if (from) args.push('--from', from);
    await runCliCommand(args);
  }
  ```

- **`commit(branchId: string, message: string, facts: string[]): Promise<MemoryCommit>`**
  - Validation: Ensure `branchId` and `message` are non-empty; `facts` should be an array.
  - Shell Call: `memfork commit <branchId> -m "<message>" --facts "<fact1>" "<fact2>" ...`
  - Response Handling: Expects the command to return a serialized JSON string representing the newly created `MemoryCommit`. Parse and return the object.
  ```typescript
  export async function commit(branchId: string, message: string, facts: string[]): Promise<MemoryCommit> {
    if (!branchId) throw new Error('Branch ID is required.');
    if (!message) throw new Error('Commit message is required.');
    const args = ['commit', branchId, '-m', message];
    if (facts && facts.length > 0) {
      args.push('--facts', ...facts);
    }
    const response = await runCliCommand(args);
    return JSON.parse(response) as MemoryCommit;
  }
  ```

- **`recall(branchId: string): Promise<string[]>`**
  - Validation: Ensure `branchId` is specified.
  - Shell Call: `memfork recall <branchId>`
  - Response Handling: Traverses branch commits upwards to the root to collect all facts. Expects the command to return a JSON array of strings `["fact A", "fact B"]` or a newline-separated string.
  ```typescript
  export async function recall(branchId: string): Promise<string[]> {
    if (!branchId) throw new Error('Branch ID is required.');
    const response = await runCliCommand(['recall', branchId]);
    try {
      return JSON.parse(response) as string[];
    } catch {
      return response.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
    }
  }
  ```

---

## 7. Testing Strategies (Unit, Integration, and Sandbox Isolation)

We design a test suite structured to run via **Vitest** or the native Node.js test runner (`node:test` and `node:assert`) with zero-poll sandboxing.

### 7.1 Sandbox Isolation Helper (`tests/helpers/db-sandbox.ts`)
Each test suite runs inside a fresh temporary directory, avoiding contamination of the user's active database:
- **Setup**:
  1. Define a temporary directory `.memfork/test-env/`.
  2. Set `process.env.MEMFORK_DB_PATH = path.resolve('.memfork/test-env/db.test.json')`.
  3. Set `process.env.MEMFORK_CLI_PATH = path.resolve('scripts/mock-memfork.js')`.
- **Teardown**: Deletes the `.memfork/test-env/` directory to clean up state.

### 7.2 DB CRUD Unit Tests
- **Bootstrap Verification**: Trigger `readDb()` without any file existing and verify it initiates the directory and database structure successfully.
- **Atomic Operations / Race Condition Test**:
  - Issue 10 concurrent calls to `addMessage()` in parallel.
  - Assert that all 10 messages appear in the output database without any lost writes or corrupted JSON errors.
- **Schema Constraints**:
  - Verify that adding a duplicate branch name to `addBranch()` triggers a validation error.
- **Corrupt Recovery**:
  - Write invalid/malformed JSON string `{"branches":` to the test file.
  - Call `readDb()`. Check that the corrupt file is backed up and a fresh DB is generated.

### 7.3 Integration CLI Mocking Tests
Verify the child process CLI wrapper interacts properly with the `scripts/mock-memfork.js` executable:
- **`branch` command test**:
  - Run `branch("dev")` followed by `branch("feature-a", "dev")`.
  - Inspect the database directly via `readDb()`. Assert that both branches exist and that `parentBranchId` for `"feature-a"` points to `"dev"`.
- **`commit` command test**:
  - Run `commit("dev", "Add UI", ["Use Tailwind"])`.
  - Assert that a `MemoryCommit` is returned, matches the schema, and that the commit appears under `"dev"` in the JSON database.
- **`recall` command test (DAG Ancestry search)**:
  - Commit `"Fact 1"` to `"dev"`.
  - Create branch `"feature-a"` from `"dev"`.
  - Commit `"Fact 2"` to `"feature-a"`.
  - Call `recall("feature-a")`.
  - Assert that the returned array contains both `["Fact 1", "Fact 2"]` (correct lineage search).

---

## 8. Project Setup and Configuration Requirements

To compile and launch the project successfully, we must configure three boilerplate files in the root directory:

### 8.1 `package.json`
Specifies configuration, build processes, dependencies, and test commands:
```json
{
  "name": "memfork-agentos-memory-lab",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "verify": "node scripts/verify-project.js"
  },
  "dependencies": {
    "next": "15.0.0",
    "react": "19.0.0-rc",
    "react-dom": "19.0.0-rc",
    "lucide-react": "^0.450.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2",
    "reactflow": "^11.10.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.12.0",
    "@types/react": "^19.0.0",
    "vitest": "^2.0.0",
    "tailwindcss": "^3.4.1",
    "postcss": "^8.4.35",
    "eslint": "^9.0.0"
  }
}
```

### 8.2 `tsconfig.json`
Specifies standard ESModule Next.js configurations and aliases:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 8.3 `.gitignore`
Ensures state, build artifacts, and test sandboxes are not checked in:
```text
node_modules/
.next/
.memfork/
!.memfork/db.json
.memfork/test-env/
*.tmp
*.corrupt.*
```
