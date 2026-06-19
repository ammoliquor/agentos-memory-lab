# Analysis & Design Fix Strategy Report — Explorer 3 Gen 2

## Executive Summary

During the first verification iteration of Milestone 1, several critical bugs, race conditions, and vulnerabilities were identified by reviewers and challengers. This report provides a detailed, production-grade design strategy to fix the identified bugs across the database layer, memory module, CLI wrapper, and mock CLI. 

Our strategy focuses on:
1. **Memory-Level Concurrency**: Serializing the entire read-modify-write transactional sequence within a single enqueued promise in `lib/db/db.ts`.
2. **Process-Level Concurrency & Windows Lockouts**: Using atomic directory-creation locking (`db.json.lock`) to serialize file access across separate processes (Next.js server vs. spawned Node.js child processes), and utilizing unique temp files to prevent write/rename clashes on Windows.
3. **DAG-Based Branch Isolation**: Transitioning branch fact recall from a simplistic branch ID filter to a strict git-like commit DAG backward traversal starting from the branch's head commit via `parentCommit` pointers.
4. **Order-Independent Argument Parsing**: Restructuring mock CLI command parsing in `scripts/mock-memfork.js` with a sequential state-machine parser to handle hyphenated facts and flag collisions safely.
5. **Windows Injection & Process Orphaning Mitigation**: Disabling `shell: true` in `lib/memory/memfork.ts` and sanitizing branch names. Running with `shell: false` ensures `child.kill()` directly terminates the Node process on Windows instead of killing a dummy `cmd.exe` wrapper.
6. **Lossless Merge Resolution**: Modifying the conflict-resolution block in `lib/memory/merge.ts` to preserve non-conflicting unique facts from the source branch.
7. **Schema Completeness**: Adding validation for `mergeProposals` and `forkCommitId` in `validateSchema`.

---

## 1. Concurrency Lost-Update Race Condition (Memory Level)

### Problem & Root Cause
In `lib/db/db.ts`, individual calls to `readDb` and `writeDb` are enqueued separately on a global promise chain (`queue`). However, update helpers like `addBranch`, `addCommit`, and `addMessage` perform a read-modify-write cycle:
```typescript
const db = await readDb(); // Enqueues and completes read task
// ... modifies db in memory ...
await writeDb(db); // Enqueues write task
```
If multiple operations run concurrently, they all enqueue their read tasks back-to-back, reading the same stale state. They then modify their local copies and enqueue write tasks back-to-back. Each write overwrites the previous ones, resulting in lost updates.

### Proposed Fix Strategy
We will implement an atomic `updateDb` helper that wraps the entire read-modify-write cycle in a single enqueued promise. We will split `readDb` and `writeDb` into internal helpers (`readDbInternal` and `writeDbInternal`) that perform raw I/O without enqueuing separately.

#### Proposed Implementation Details

```typescript
// lib/db/db.ts

// Split readDb and writeDb into internal direct-I/O helpers
async function readDbInternal(): Promise<DatabaseSchema> {
  const dbPath = getDbPath();
  try {
    const content = await fs.readFile(dbPath, 'utf8');
    const parsed = JSON.parse(content) as DatabaseSchema;
    if (!validateSchema(parsed)) {
      throw new Error('Invalid schema in readDb');
    }
    return parsed;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      await fs.rename(tempPath, dbPath);
      return defaultDb;
    }
    throw error;
  }
}

async function writeDbInternal(db: DatabaseSchema): Promise<void> {
  if (!validateSchema(db)) {
    throw new Error('Invalid database schema');
  }
  const dbPath = getDbPath();
  const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`; // Unique temp path per process/write
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tempPath, dbPath);
}

// Exported public API enqueues single tasks
export async function readDb(): Promise<DatabaseSchema> {
  return enqueue(() => readDbInternal());
}

export async function writeDb(db: DatabaseSchema): Promise<void> {
  return enqueue(() => writeDbInternal(db));
}

// Atomic update helper
export async function updateDb(updateFn: (db: DatabaseSchema) => void | Promise<void>): Promise<void> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    await acquireLockAsync(dbPath); // Process-level lock (Section 2)
    try {
      const db = await readDbInternal();
      await updateFn(db);
      await writeDbInternal(db);
    } finally {
      await releaseLockAsync(dbPath);
    }
  });
}

// Refactored mutations
export async function addBranch(branch: Branch): Promise<void> {
  await updateDb((db) => {
    if (db.branches.some(b => b.name === branch.name || b.id === branch.id)) {
      throw new Error(`Branch with name "${branch.name}" or ID "${branch.id}" already exists`);
    }
    db.branches.push(branch);
  });
}

export async function addCommit(commit: Commit): Promise<void> {
  await updateDb((db) => {
    db.commits.push(commit);
  });
}

export async function addMessage(message: Message): Promise<void> {
  await updateDb((db) => {
    db.messages.push(message);
  });
}
```

---

## 2. Multi-Process Concurrency & Windows Lockouts (Process Level)

### Problem & Root Cause
When multiple agents or parallel pipelines run `memfork` commands concurrently, separate OS processes are spawned. The in-process promise queue in `db.ts` cannot serialize these separate processes. 
Furthermore:
1. They all attempt to write to the exact same hardcoded temp file (`db.json.tmp`) before renaming it, causing write collisions.
2. On Windows, concurrent file reads, writes, and renames on the same paths cause file lockout errors (`EPERM`, `EBUSY`).

### Proposed Fix Strategy
1. **OS-Level Directory-Based Locking**: We will use atomic directory creation (`db.json.lock`) to serialize file operations across multiple processes. `fs.mkdir` (and `fs.mkdirSync`) is atomic at the OS level across both Windows and Unix.
2. **Unique Temp File Paths**: We will include a unique process identifier/UUID in temp file names to avoid collisions.
3. **Deadlock Protection**: Implement a retry loop with a random backoff and lock cleanup for stale locks (older than 10 seconds).

#### Proposed Implementation Details

##### In-Memory/NextJS Async Locking (`lib/db/db.ts`):
```typescript
async function acquireLockAsync(dbPath: string, timeoutMs = 10000): Promise<void> {
  const lockPath = `${dbPath}.lock`;
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockPath);
      return; // Lock acquired
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          const stats = await fs.stat(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            await fs.rmdir(lockPath); // Clean stale lock
          }
        } catch (_) {}
        if (Date.now() - start > timeoutMs) {
          throw new Error('Lock acquisition timeout');
        }
        await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)));
      } else {
        throw err;
      }
    }
  }
}

async function releaseLockAsync(dbPath: string): Promise<void> {
  const lockPath = `${dbPath}.lock`;
  try {
    await fs.rmdir(lockPath);
  } catch (_) {}
}
```

##### Mock CLI Sync Locking (`scripts/mock-memfork.js`):
```javascript
function acquireLockSync(dbPath, timeoutMs = 10000) {
  const lockPath = dbPath + '.lock';
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stats = fs.statSync(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            fs.rmdirSync(lockPath);
          }
        } catch (_) {}
        if (Date.now() - start > timeoutMs) {
          throw new Error('Lock acquisition timeout');
        }
        const sleepUntil = Date.now() + 20 + Math.floor(Math.random() * 30);
        while (Date.now() < sleepUntil) {}
      } else {
        throw err;
      }
    }
  }
}

function releaseLockSync(dbPath) {
  const lockPath = dbPath + '.lock';
  try {
    fs.rmdirSync(lockPath);
  } catch (_) {}
}

function runTransactional(fn) {
  const dbPath = getDbPath();
  acquireLockSync(dbPath);
  try {
    return fn();
  } finally {
    releaseLockSync(dbPath);
  }
}
```
All commands in `mock-memfork.js` will wrap their reads and writes inside `runTransactional`.

---

## 3. Branch Isolation Recall Violation

### Problem & Root Cause
To recall a branch's facts, both `mock-memfork.js` and `merge.ts` traverse parent branches and query *all* commits belonging to those branch IDs. If a new commit is added to `main` *after* `feature-a` was forked from it, recalling `feature-a` will pull in that new `main` commit. This leaks parent state and violates branch isolation.
Additionally, when creating the first commit on a child branch, `mock-memfork.js` sets `parentCommit` to `null`, completely disconnecting the commit DAG.

### Proposed Fix Strategy
1. **Extend Branch Schema**: Add an optional `forkCommitId` to the `Branch` interface to store the parent branch's head commit at branching time.
2. **DAG Traversal for Fact Recall**: Walk the commit DAG *backwards* from the head commit of the target branch using `parentCommit` pointers (handling comma-separated lists for merges) rather than filtering by branch ID.
3. **Fix First Commit Linkage**: When committing to a branch with no commits, set `parentCommit` to the branch's `forkCommitId` or the parent branch's head commit.

#### Proposed Implementation Details

##### In `scripts/mock-memfork.js` (Branch Creation):
```javascript
// Resolve the fork commit ID (parent's head commit at branching time)
let forkCommitId = null;
if (parentBranchId) {
  let pBranchId = parentBranchId;
  while (pBranchId && !forkCommitId) {
    const pCommits = db.commits.filter(c => c.branchId === pBranchId).sort((a, b) => b.timestamp - a.timestamp);
    if (pCommits.length > 0) {
      forkCommitId = pCommits[0].id;
    } else {
      const pBranchObj = db.branches.find(b => b.id === pBranchId);
      pBranchId = pBranchObj ? pBranchObj.parentBranchId : null;
    }
  }
}

const newBranch = {
  id: name,
  name: name,
  parentBranchId: parentBranchId,
  forkCommitId: forkCommitId
};
```

##### In `scripts/mock-memfork.js` (Commit Parent Linkage):
```javascript
const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
let parentCommit = null;
if (branchCommits.length > 0) {
  branchCommits.sort((a, b) => b.timestamp - a.timestamp);
  parentCommit = branchCommits[0].id;
} else if (branchObj.forkCommitId) {
  parentCommit = branchObj.forkCommitId;
} else if (branchObj.parentBranchId) {
  // Backwards compatibility fallback if forkCommitId is missing
  let pBranchId = branchObj.parentBranchId;
  while (pBranchId && !parentCommit) {
    const pCommits = db.commits.filter(c => c.branchId === pBranchId).sort((a, b) => b.timestamp - a.timestamp);
    if (pCommits.length > 0) {
      parentCommit = pCommits[0].id;
    } else {
      const pBranchObj = db.branches.find(b => b.id === pBranchId);
      pBranchId = pBranchObj ? pBranchObj.parentBranchId : null;
    }
  }
}
```

##### Backward DAG Traversal Engine (`lib/memory/merge.ts` and `scripts/mock-memfork.js`):
```typescript
function getBranchHeadCommitId(branchId: string, db: DatabaseSchema): string | null {
  const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
  if (!branchObj) return null;

  const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
  if (branchCommits.length > 0) {
    branchCommits.sort((a, b) => b.timestamp - a.timestamp);
    return branchCommits[0].id;
  }
  if (branchObj.forkCommitId) {
    return branchObj.forkCommitId;
  }
  
  // Walk parent branches for backwards compatibility
  let parentId = branchObj.parentBranchId;
  const visitedBranches = new Set<string>([branchObj.id]);
  while (parentId) {
    if (visitedBranches.has(parentId)) break;
    visitedBranches.add(parentId);
    
    const parentObj = db.branches.find(b => b.id === parentId || b.name === parentId);
    if (!parentObj) break;
    const parentCommits = db.commits.filter(c => c.branchId === parentObj.id);
    if (parentCommits.length > 0) {
      parentCommits.sort((a, b) => b.timestamp - a.timestamp);
      return parentCommits[0].id;
    }
    parentId = parentObj.parentBranchId;
  }
  return null;
}

function getAncestorCommits(startCommitId: string | null, db: DatabaseSchema): Commit[] {
  if (!startCommitId) return [];
  const commitMap = new Map<string, Commit>();
  for (const c of db.commits) {
    commitMap.set(c.id, c);
  }

  const visited = new Set<string>();
  const list: Commit[] = [];
  const queue: string[] = [startCommitId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const commit = commitMap.get(currentId);
    if (commit) {
      list.push(commit);
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(',');
        for (const p of parents) {
          if (p && !visited.has(p)) {
            queue.push(p);
          }
        }
      }
    }
  }
  return list.sort((a, b) => a.timestamp - b.timestamp);
}

// Updated recallFacts using DAG
export function recallFacts(branchId: string, db: DatabaseSchema): string[] {
  const headCommitId = getBranchHeadCommitId(branchId, db);
  if (!headCommitId) return [];

  const ancestors = getAncestorCommits(headCommitId, db);
  const allFacts: string[] = [];
  for (const commit of ancestors) {
    for (const fact of commit.facts) {
      if (!allFacts.includes(fact)) {
        allFacts.push(fact);
      }
    }
  }
  return allFacts;
}
```

---

## 4. CLI Facts Argument Parsing Truncation

### Problem & Root Cause
In `scripts/mock-memfork.js`, the argument parser loops through CLI inputs after the `--facts` flag and breaks as soon as it encounters any string starting with a dash (`-`). Because markdown facts and bullet points often begin with a dash (e.g. `"- Postgres scales well"`), this check truncates and discards those facts entirely.
Global searches like `indexOf('-m')` also fail if a branch or commit message matches `-m` or `--facts`.

### Proposed Fix Strategy
We will implement an order-independent state-machine argument parser inside `scripts/mock-memfork.js`. This parser iterates through the arguments from index 2 onwards sequentially, capturing all values under `--facts` until another known CLI flag (like `-m`) is found.

#### Proposed Implementation Details
```javascript
// scripts/mock-memfork.js (Inside main, command === 'commit')
let message = null;
let facts = [];
let i = 2;
while (i < args.length) {
  if (args[i] === '-m') {
    message = args[i + 1];
    i += 2;
  } else if (args[i] === '--facts') {
    i += 1;
    while (i < args.length && args[i] !== '-m') {
      facts.push(args[i]);
      i++;
    }
  } else {
    i++;
  }
}
```

---

## 5. Windows Command Injection Risk & Process Orphaning

### Problem & Root Cause
1. `memfork.ts` spawns CLI commands using `{ shell: true }` on Windows. If branch names contain shell metacharacters like `&` or `|`, they can be interpreted as shell commands, exposing command injection risks.
2. On timeout, calling `child.kill()` on Windows terminates the `cmd.exe` shell wrapper but leaves the child Node.js script running as an orphan, which continues to run and hold file locks.

### Proposed Fix Strategy
1. **Remove Shell Invocation**: Run spawned child processes with `{ shell: false }`. Since the CLI is a Node.js script, we can invoke `node` directly on the script file.
2. **Eliminate Orphaning**: Spawning directly (with `shell: false`) maps `child` to the actual Node process. When `child.kill()` is invoked, Windows directly terminates the Node process without orphan issues.
3. **Sanitize Inputs**: Validate branch names using a strict regex (e.g. `/^[a-zA-Z0-9-_]+$/`) to reject invalid/dangerous names before spawning.

#### Proposed Implementation Details
```typescript
// lib/memory/memfork.ts
import { spawn } from 'child_process';

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
      env: { ...process.env },
      shell: false // Prevent command injection and process orphaning on Windows
    });
    
    // ... stdout/stderr collection & timeout handling ...
  });
}

// Branch name validation
export async function branch(name: string, from?: string): Promise<void> {
  if (!name || name.trim() === '') {
    throw new Error('Branch name cannot be empty');
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    throw new Error('Invalid branch name. Must be alphanumeric with hyphens or underscores.');
  }
  const args = ['branch', name];
  if (from) {
    if (!/^[a-zA-Z0-9-_]+$/.test(from)) {
      throw new Error('Invalid parent branch name.');
    }
    args.push('--from', from);
  }
  await runMemforkCommand(args);
}
```

---

## 6. Fact Loss During Conflict Resolution

### Problem & Root Cause
In `lib/memory/merge.ts`, if conflicts exist and `resolvedFacts` are supplied, the facts committed to the merge commit are calculated as:
```typescript
mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
```
This logic completely ignores `diffFacts(factsTarget, factsSource).uniqueB`, which contains all the non-conflicting unique facts of the source branch. As a result, when resolving a single conflict, all other non-conflicting changes from the source branch are discarded.

### Proposed Fix Strategy
We will extract non-conflicting source facts from `diff.uniqueB` by filtering out any facts that were involved in conflicts. We then combine these non-conflicting unique source facts with the manual resolutions.

#### Proposed Implementation Details
```typescript
// lib/memory/merge.ts (Inside mergeBranches)
let mergeFacts: string[] = [];
const diff = diffFacts(factsTarget, factsSource);

if (conflicts.length > 0) {
  // Find all facts from source branch involved in a conflict
  const conflictingSourceFacts = new Set(conflicts.map(c => c.factB));
  // Filter uniqueB to keep only non-conflicting source facts
  const nonConflictingSourceFacts = diff.uniqueB.filter(f => !conflictingSourceFacts.has(f));

  mergeFacts = [
    ...resolvedFacts.filter(f => !factsTarget.includes(f)),
    ...nonConflictingSourceFacts.filter(f => !resolvedFacts.includes(f))
  ];
} else {
  mergeFacts = diff.uniqueB;
}
```

---

## 7. Missing `mergeProposals` Validation in `validateSchema`

### Problem & Root Cause
The `DatabaseSchema` interface requires the `mergeProposals` property. However, `validateSchema` in `lib/db/db.ts` and `scripts/mock-memfork.js` does not assert the presence or types of `mergeProposals`. If a JSON file is missing this field, validation passes, but subsequent array operations (e.g. `.push()`) will crash at runtime with a `TypeError`.

### Proposed Fix Strategy
Add array check and deep property checks for `mergeProposals` to `validateSchema`.

#### Proposed Implementation Details
```typescript
// lib/db/db.ts (and scripts/mock-memfork.js)
export function validateSchema(db: DatabaseSchema): boolean {
  if (!db || typeof db !== 'object') return false;
  if (!Array.isArray(db.branches)) return false;
  if (!Array.isArray(db.commits)) return false;
  if (!Array.isArray(db.messages)) return false;
  if (!Array.isArray(db.mergeProposals)) return false; // Missing check

  // Validate branches
  for (const b of db.branches) {
    if (typeof b.id !== 'string' || typeof b.name !== 'string') return false;
    if (b.parentBranchId !== null && typeof b.parentBranchId !== 'string') return false;
    if (b.forkCommitId !== undefined && b.forkCommitId !== null && typeof b.forkCommitId !== 'string') return false;
  }
  
  // Validate mergeProposals
  for (const mp of db.mergeProposals) {
    if (typeof mp.id !== 'string' || typeof mp.sourceBranchId !== 'string' || typeof mp.targetBranchId !== 'string') return false;
    if (mp.status !== 'CONFLICT' && mp.status !== 'RESOLVED') return false;
    if (typeof mp.timestamp !== 'number') return false;
    if (!Array.isArray(mp.conflicts)) return false;
    for (const c of mp.conflicts) {
      if (typeof c.factA !== 'string' || typeof c.factB !== 'string' || typeof c.reason !== 'string' || typeof c.severity !== 'string') return false;
    }
  }

  // ... rest of validation ...
  return true;
}
```

---

## Additional Robustness Recommendations

### 8. Exact Word Boundaries in Contradiction Checks
The contradiction detection uses `.includes("no")` to check for negations. Unrelated words like `"node"` or `"normal"` can trigger false-positive conflicts.
- **Fix**: Replace substring matches with regex word-boundary checks, e.g., `/\bno\b/i`, `/\bdo not\b/i`.

### 9. Environment Sandboxing in Test Runner
In `scripts/run-e2e.js`, set `process.env.NODE_ENV = 'test'` to comply with the environment isolation contract in `TEST_INFRA.md`.
