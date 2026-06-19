# Milestone 1: Requirements & Architecture Analysis

## 1. Development Environment & Tool Analysis

### 1.1 Development Tools in PATH
During environmental analysis, command-line diagnostic tools (`node -v`, `npm -v`, `tsc -v`) were executed to query the PATH. However, due to headless environment constraints, the permission prompts for `run_command` timed out. 
Based on the project dependencies described in `PROJECT.md` (Next.js 15, React 19, TypeScript), we assume a modern Node.js environment (v18.x or v20.x+) is available, along with standard package managers (`npm`, `pnpm`, or `yarn`) and TypeScript (`tsc`). 

### 1.2 'memfork' Executable Check
Due to the command execution timeouts, direct verification of a system-wide `memfork` executable (via `where memfork` or `memfork --help`) could not be completed.
To maintain environment-agnostic execution, we adopt the dual-mode execution strategy defined in `TEST_INFRA.md`:
1. **Mock CLI Executable (`scripts/mock-memfork.js`)**: A Node.js CLI script that mimics the real `memfork` command.
2. **Environment Variable Injection**: The wrapper (`lib/memory/memfork.ts`) will check `process.env.MEMFORK_CLI_PATH`.
   - If set, it executes `node <MEMFORK_CLI_PATH> <args>`.
   - If not set, it defaults to executing the system `memfork` command.

---

## 2. Project Requirements & Layout Review

### 2.1 Workspace Structure
A complete directory scan of `C:\Users\USER\antigravitycliproject\memfork` reveals that the workspace is empty except for:
- `.agents/` (meta files)
- `PROJECT.md`
- `TEST_INFRA.md`

No codebase layout has been established yet. Thus, bootstrapping all configuration files (`package.json`, `tsconfig.json`) and source directories (`lib/`, `app/`) is a prerequisite for Milestone 1.

### 2.2 Scope of Milestone 1
According to `SCOPE.md`, the objective is to implement:
1. DB Schema & Helpers in `.memfork/db.json` and `lib/db/db.ts`.
2. `memfork` CLI Wrapper in `lib/memory/memfork.ts` wrapping `branch`, `commit`, and `recall`.
3. Unit and integration tests to verify these components.

---

## 3. Database Schema Design (`.memfork/db.json`)

To support multi-agent branching, commit tracking, and message history, the JSON database must store three collections: `branches`, `commits`, and `messages`.

### 3.1 TypeScript Type Definitions (`lib/types/index.ts`)
```typescript
export interface MemoryBranch {
  id: string;          // Unique branch ID (e.g. UUID or serialized name)
  name: string;        // Human-readable branch name (e.g., "main", "research-db")
  parentBranchId: string | null; // ID of the branch this was forked from
}

export interface MemoryCommit {
  id: string;          // Unique commit hash or identifier
  branchId: string;    // ID of the branch this commit belongs to
  message: string;     // Commit summary message
  facts: string[];     // Array of facts committed in this step
  parentCommitId: string | null; // Parent commit hash in the DAG
  timestamp: string;   // ISO 8601 Datetime string
}

export interface ChatMessage {
  id: string;          // Unique message ID
  branchId: string;    // Messages are associated with a branch's thread
  role: 'user' | 'assistant' | 'system';
  content: string;     // Message content
  agentType?: 'Research' | 'Critic' | 'Builder' | null; // Multi-agent roles
  timestamp: string;   // ISO 8601 Datetime string
}

export interface DatabaseSchema {
  branches: MemoryBranch[];
  commits: MemoryCommit[];
  messages: ChatMessage[];
}
```

### 3.2 Sample Database Payload
```json
{
  "branches": [
    {
      "id": "main",
      "name": "main",
      "parentBranchId": null
    },
    {
      "id": "branch-research",
      "name": "branch-research",
      "parentBranchId": "main"
    }
  ],
  "commits": [
    {
      "id": "c1",
      "branchId": "main",
      "message": "Initial project scope",
      "facts": ["Database must scale to 10k rps"],
      "parentCommitId": null,
      "timestamp": "2026-06-18T22:00:00.000Z"
    },
    {
      "id": "c2",
      "branchId": "branch-research",
      "message": "Research database option ClickHouse",
      "facts": ["ClickHouse is extremely fast for columnar queries", "ClickHouse is not transactional"],
      "parentCommitId": "c1",
      "timestamp": "2026-06-18T22:05:00.000Z"
    }
  ],
  "messages": [
    {
      "id": "m1",
      "branchId": "main",
      "role": "user",
      "content": "Start analyzing timeseries database options.",
      "timestamp": "2026-06-18T21:59:00.000Z"
    }
  ]
}
```

---

## 4. Database CRUD Helpers Design (`lib/db/db.ts`)

### 4.1 Path Resolution & Bootstrapping
- **Path Resolution**: Check `process.env.MEMFORK_DB_PATH` first. If undefined, default to `<workspace_root>/.memfork/db.json`.
- **Bootstrapping**: If the target file or parent folder does not exist, initialize them automatically with an empty DB schema layout `{ "branches": [], "commits": [], "messages": [] }`.

### 4.2 Atomic Write Queue
To prevent race conditions during concurrent writes (e.g. from parallel agent threads), writes must be serialized. 
We plan a simple, dependency-free promise-chaining write queue:

```typescript
let writeQueue = Promise.resolve();

export async function enqueueWrite<T>(writeFn: () => Promise<T>): Promise<T> {
  const resultPromise = writeQueue.then(writeFn);
  writeQueue = resultPromise.then(() => {}).catch(() => {});
  return resultPromise;
}
```

When saving, write first to a temporary file (`.memfork/db.json.tmp`) and then perform an atomic rename (`fs.promises.rename`) to avoid file corruption on partial disk writes.

### 4.3 CRUD Helper Signature Plan
- `getDatabase(): Promise<DatabaseSchema>`: Reads, parses, and returns the DB.
- `saveDatabase(data: DatabaseSchema): Promise<void>`: Serializes and atomically writes the DB using the write queue.
- `getBranches(): Promise<MemoryBranch[]>`
- `createBranch(branch: Omit<MemoryBranch, 'id'>): Promise<MemoryBranch>` (Validates uniqueness of names).
- `getCommits(branchId?: string): Promise<MemoryCommit[]>`
- `createCommit(commit: Omit<MemoryCommit, 'id' | 'timestamp'>): Promise<MemoryCommit>`
- `getMessages(branchId: string): Promise<ChatMessage[]>`
- `createMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage>`

---

## 5. CLI Wrapper Design (`lib/memory/memfork.ts`)

This module wraps the `memfork` CLI using Node's `child_process.execFile` or `spawn` to run commands.

### 5.1 CLI Execution Engine
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

function getCliCommand(): { cmd: string; args: string[] } {
  const cliPath = process.env.MEMFORK_CLI_PATH;
  if (cliPath) {
    return { cmd: 'node', args: [path.resolve(cliPath)] };
  }
  return { cmd: 'memfork', args: [] };
}

async function runCli(args: string[]): Promise<string> {
  const { cmd, args: baseArgs } = getCliCommand();
  const fullArgs = [...baseArgs, ...args];
  
  try {
    const { stdout, stderr } = await execFileAsync(cmd, fullArgs, {
      env: { ...process.env }
    });
    if (stderr && stderr.trim()) {
      console.warn(`CLI Warn: ${stderr}`);
    }
    return stdout;
  } catch (error: any) {
    throw new Error(`memfork CLI execution failed: ${error.stderr || error.message}`);
  }
}
```

### 5.2 API Interface Implementation
- **`branch(name: string, from?: string): Promise<void>`**
  - CLI: `memfork branch <name> [--from <from>]`
  - Validates name and inputs before spawning child_process.
- **`commit(branchId: string, message: string, facts: string[]): Promise<MemoryCommit>`**
  - CLI: `memfork commit <branchId> -m <message> --facts <facts...>`
  - Parses the JSON string output from stdout to return the `MemoryCommit` object.
- **`recall(branchId: string): Promise<string[]>`**
  - CLI: `memfork recall <branchId>`
  - Parses the stdout containing JSON string of facts and returns `string[]`.

---

## 6. Testing Strategy

### 6.1 Unit Testing (`tests/unit/db.test.ts`)
- Use a dedicated sandbox database directory for unit testing.
- Set `MEMFORK_DB_PATH` to `tests/sandbox/db.json`.
- Test cases:
  1. Bootstrapping: deletes the sandbox DB, calls `getDatabase()`, verifies the file is created with correct defaults.
  2. CRUD: saves a branch, retrieves it, verifies deep equal.
  3. Atomic updates: triggers 10 concurrent message writes and ensures all 10 write successfully.
  4. Validation: ensures duplicate branch name creation throws error.

### 6.2 Integration Testing via CLI Mocking (`tests/integration/cli.test.ts`)
- Set `MEMFORK_CLI_PATH` to `scripts/mock-memfork.js`.
- Set `MEMFORK_DB_PATH` to `tests/sandbox/db.json`.
- Write `scripts/mock-memfork.js` which parses incoming arguments and interacts directly with the test database using the `lib/db/db.ts` methods.
- Test cases:
  1. Spawning CLI `branch` command creates the branch record in the database.
  2. Spawning CLI `commit` command creates a commit object in the database and yields valid JSON.
  3. Spawning CLI `recall` command recursively crawls the commit DAG and returns all parent and child facts.

---

## 7. Setup & Configuration Requirements

Because this is a completely empty workspace, we must configure:

### 7.1 `package.json`
Provides Next.js 15, React 19, TypeScript, and Vitest test dependencies:
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
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "vitest": "^2.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "eslint": "^9.0.0"
  }
}
```

### 7.2 `tsconfig.json`
Provides compilation config for Next.js, ESModules, and paths matching `@/*`:
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
