# Milestone 1 Code Review & Fix Design Strategy Report

## Consensus & Core Findings Summary
This report analyzes and designs complete fix strategies for the 7 bugs identified during the verification iteration of Milestone 1. The primary focus is establishing absolute correctness across memory-level and process-level concurrency, resolving branch isolation violations by transitioning to a DAG-based traversal model, preventing Windows command execution and process orphaning vulnerabilities, and securing fact merges and schema validations.

---

## Detailed Bug Analysis & Fix Strategies

### Issue 1: Concurrency Lost-Update Race Condition in `lib/db/db.ts` (Memory Level)

#### 1. Problem Analysis
The functions `addBranch`, `addCommit`, and `addMessage` in `lib/db/db.ts` perform a non-atomic read-modify-write cycle:
```typescript
const db = await readDb(); // Reads file (serialized in queue)
// ... modifies db object ...
await writeDb(db); // Writes file (serialized in queue)
```
Although `readDb` and `writeDb` are serialized individually in the promise `enqueue` queue, the sequence itself is not atomic. If two concurrent database calls are launched, they both enqueue their `readDb` tasks sequentially. Both read the same initial state from disk. Both perform separate, concurrent in-memory modifications, and both enqueue their `writeDb` tasks. The second write completely overwrites the first write, leading to silent data loss.

#### 2. Concrete Design & Code Fix
Define an internal, non-enqueued reader/writer pair and introduce a transactional helper `updateDb` that serializes the entire read-modify-write sequence within a single enqueued block.

```typescript
// 1. Internal helpers in lib/db/db.ts (not enqueued)
async function readDbInternal(): Promise<DatabaseSchema> {
  const dbPath = getDbPath();
  try {
    const content = await fs.readFile(dbPath, 'utf8');
    try {
      const parsed = JSON.parse(content) as DatabaseSchema;
      if (!validateSchema(parsed)) {
        throw new Error('Invalid schema in readDb');
      }
      return parsed;
    } catch (jsonErr) {
      // Backup corrupt file and re-initialize
      const corruptedPath = dbPath.endsWith('.json')
        ? dbPath.slice(0, -5) + '.corrupted.json'
        : dbPath + '.corrupted';
      try {
        await fs.rename(dbPath, corruptedPath);
      } catch (_) {}
      const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      await fs.rename(tempPath, dbPath);
      return defaultDb;
    }
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
  const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tempPath, dbPath);
}

// 2. Transactional wrapper enqueued on the promise chain
export async function updateDb<T>(updater: (db: DatabaseSchema) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    const lockDir = dbPath + '.lock';
    await acquireLock(lockDir); // Process lock (Issue 2)
    try {
      const db = await readDbInternal();
      const result = await updater(db);
      await writeDbInternal(db);
      return result;
    } finally {
      await releaseLock(lockDir);
    }
  });
}

// 3. Keep readDb and writeDb backwards-compatible but locked
export async function readDb(): Promise<DatabaseSchema> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    const lockDir = dbPath + '.lock';
    await acquireLock(lockDir);
    try {
      return await readDbInternal();
    } finally {
      await releaseLock(lockDir);
    }
  });
}

export async function writeDb(db: DatabaseSchema): Promise<void> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    const lockDir = dbPath + '.lock';
    await acquireLock(lockDir);
    try {
      await writeDbInternal(db);
    } finally {
      await releaseLock(lockDir);
    }
  });
}

// 4. Update mutation functions to be atomic
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

### Issue 2: Concurrency Multi-Process Write Collisions & File Lockouts (Process Level)

#### 1. Problem Analysis
During concurrent pipeline execution (such as the parallel multi-agent orchestrator runs), separate Node.js child processes are spawned running `scripts/mock-memfork.js`. Since these are separate OS processes, they bypass the in-memory promise queue in `db.ts`. They read and write the JSON database file concurrently using synchronous file operations. 
Furthermore, they all write to a hardcoded temp file (`db.json.tmp`) before renaming it to `db.json`. This causes:
1. File locking conflicts on Windows (`EPERM` or `EBUSY`).
2. Temp file collisions where one process deletes or renames another's temp file.
3. Silent data loss from race conditions.

#### 2. Concrete Design & Code Fix
1. Implement a cross-platform, process-level atomic file lock using directory creation (`fs.mkdir` and `fs.mkdirSync`), which is atomic at the OS level on Windows and Unix-like environments.
2. Ensure every write uses a unique temporary file path incorporating `crypto.randomUUID()` to prevent collisions.

```typescript
// Async Lock Implementation in lib/db/db.ts
import * as crypto from 'crypto';

async function acquireLock(lockDir: string, timeout = 10000, retryInterval = 50): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockDir);
      return;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }
    
    // Clean up stale lock if it is older than 15 seconds
    try {
      const stats = await fs.stat(lockDir);
      if (Date.now() - stats.mtimeMs > 15000) {
        await fs.rmdir(lockDir);
        continue;
      }
    } catch (_) {}

    if (Date.now() - start > timeout) {
      throw new Error(`Lock acquisition timed out on ${lockDir}`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }
}

async function releaseLock(lockDir: string): Promise<void> {
  try {
    await fs.rmdir(lockDir);
  } catch (_) {}
}
```

For the synchronous context in `scripts/mock-memfork.js`:
```javascript
// Sync Lock Implementation in scripts/mock-memfork.js
async function acquireLock(lockDir, timeout = 10000, retryInterval = 50) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    try {
      const stats = fs.statSync(lockDir);
      if (Date.now() - stats.mtimeMs > 15000) {
        fs.rmdirSync(lockDir);
        continue;
      }
    } catch (_) {}

    if (Date.now() - start > timeout) {
      throw new Error(`Lock acquisition timed out on ${lockDir}`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }
}

function releaseLock(lockDir) {
  try {
    fs.rmdirSync(lockDir);
  } catch (_) {}
}
```

*Note: The main method of `scripts/mock-memfork.js` must be wrapped in `acquireLock` and `releaseLock` blocks (see Issue 3 and Issue 4 for the consolidated structure).*

---

### Issue 3: Branch Isolation Recall Violation in `scripts/mock-memfork.js` and `lib/memory/merge.ts`

#### 1. Problem Analysis
To recall facts, the code path resolves the lineage of branches (e.g. `main` -> `feature-a`) and queries all commits belonging to those branch IDs. If a new commit is added to `main` *after* the fork `feature-a` was created, those new parent commits are incorrectly pulled into `recall("feature-a")`. This violates branch isolation and state persistence guarantees.

#### 2. Concrete Design & Code Fix
1. Add an optional/metadata field `forkCommitId` to the `Branch` object. When creating a branch, record the head commit ID of the parent branch as `forkCommitId`.
2. When creating the first commit on a child branch, point its `parentCommit` to the branch's `forkCommitId` (rather than `null`).
3. Traverse the commit DAG backwards from the head commit of the target branch using the `parentCommit` pointers (splitting by comma to handle merge commits), rather than querying by branch ID.

```javascript
// 1. Recursive branch head commit lookup function
function getBranchHeadCommitId(db, branchId) {
  const branchCommits = db.commits.filter(c => c.branchId === branchId);
  if (branchCommits.length > 0) {
    branchCommits.sort((a, b) => a.timestamp - b.timestamp);
    return branchCommits[branchCommits.length - 1].id;
  }
  const branch = db.branches.find(b => b.id === branchId || b.name === branchId);
  if (branch && branch.forkCommitId) {
    return branch.forkCommitId;
  }
  if (branch && branch.parentBranchId) {
    return getBranchHeadCommitId(db, branch.parentBranchId);
  }
  return null;
}

// 2. DAG traversal inside recall / recallFacts
function recallFacts(branchId, db) {
  const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
  if (!branchObj) {
    throw new Error(`Branch '${branchId}' not found`);
  }

  const headCommitId = getBranchHeadCommitId(db, branchObj.id);
  if (!headCommitId) {
    return [];
  }

  const visited = new Set();
  const queue = [headCommitId];
  const commitsToProcess = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const commit = db.commits.find(c => c.id === currentId);
    if (commit) {
      commitsToProcess.push(commit);
      if (commit.parentCommit) {
        // Handle potential merge commits with multi-parents
        const parents = commit.parentCommit.split(',');
        for (const p of parents) {
          queue.push(p.trim());
        }
      }
    }
  }

  // Sort chronologically by timestamp before extracting facts
  commitsToProcess.sort((a, b) => a.timestamp - b.timestamp);

  const allFacts = [];
  for (const commit of commitsToProcess) {
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

### Issue 4: CLI Facts Argument Parsing Truncation in `scripts/mock-memfork.js`

#### 1. Problem Analysis
In `scripts/mock-memfork.js`, CLI facts are parsed by iterating over the arguments following `--facts`. The parser terminates as soon as any argument starts with a hyphen:
```javascript
if (args[i].startsWith('-')) break;
```
If a fact contains a markdown-style hyphen (e.g. `"- Postgres supports scaling"`), it is incorrectly treated as a flag and the parser aborts, silently discarding the fact and all subsequent facts.
Additionally, if a branch name is `-m` or a commit message is `--facts`, global `indexOf` queries fail.

#### 2. Concrete Design & Code Fix
Implement a stateful, positional parser in `scripts/mock-memfork.js` that checks arguments sequentially and only breaks parsing if a known CLI flag (e.g., `-m`, `--from`, `--facts`, `--sleep`) is encountered.

```javascript
// Stateful CLI Argument Parser implementation
async function main() {
  if (process.env.MOCK_MEMFORK_SLEEP || process.argv.includes('--sleep')) {
    await new Promise(() => {});
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: mock-memfork <command> [args]");
    process.exit(1);
  }

  const command = args[0];
  let exitCode = 0;
  const dbPath = getDbPath();
  const lockDir = dbPath + '.lock';

  await acquireLock(lockDir);
  try {
    if (command === 'branch') {
      const name = args[1];
      if (!name || name.trim() === '') {
        console.error("Branch name cannot be empty");
        exitCode = 1;
      } else {
        let parentBranchId = null;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '--from') {
            parentBranchId = args[i + 1];
            i++;
          }
        }

        const db = readDb();
        if (db.branches.some(b => b.name === name || b.id === name)) {
          console.error(`Branch '${name}' already exists`);
          exitCode = 1;
        } else {
          if (parentBranchId) {
            const parentObj = db.branches.find(b => b.id === parentBranchId || b.name === parentBranchId);
            if (!parentObj) {
              console.error(`Parent branch '${parentBranchId}' not found`);
              exitCode = 1;
            } else {
              parentBranchId = parentObj.id;
            }
          }

          if (exitCode === 0) {
            const forkCommitId = parentBranchId ? getBranchHeadCommitId(db, parentBranchId) : null;
            const newBranch = {
              id: name,
              name: name,
              parentBranchId: parentBranchId,
              forkCommitId: forkCommitId
            };
            db.branches.push(newBranch);
            writeDb(db);
          }
        }
      }
    } else if (command === 'commit') {
      const branchId = args[1];
      if (!branchId || branchId.trim() === '') {
        console.error("Branch ID cannot be empty");
        exitCode = 1;
      } else {
        let message = null;
        let facts = [];

        // Stateful parsing of commit flags and trailing values
        for (let i = 2; i < args.length; i++) {
          if (args[i] === '-m') {
            message = args[i + 1];
            i++;
          } else if (args[i] === '--facts') {
            const knownFlags = ['-m', '--from', '--facts', '--sleep'];
            for (let j = i + 1; j < args.length; j++) {
              if (knownFlags.includes(args[j])) {
                i = j - 1; // Hand control back to main loop for this flag
                break;
              }
              facts.push(args[j]);
              i = j;
            }
          }
        }

        if (!message || message.trim() === '') {
          console.error("Commit message cannot be empty");
          exitCode = 1;
        } else {
          const db = readDb();
          const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
          if (!branchObj) {
            console.error(`Branch '${branchId}' not found`);
            exitCode = 1;
          } else {
            const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
            let parentCommit = null;
            if (branchCommits.length > 0) {
              branchCommits.sort((a, b) => a.timestamp - b.timestamp);
              parentCommit = branchCommits[branchCommits.length - 1].id;
            } else {
              parentCommit = branchObj.forkCommitId || null;
            }

            const newCommit = {
              id: 'c_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12),
              branchId: branchObj.id,
              message: message,
              facts: facts,
              parentCommit: parentCommit,
              timestamp: Date.now()
            };

            db.commits.push(newCommit);
            writeDb(db);
            console.log(JSON.stringify(newCommit));
          }
        }
      }
    } else if (command === 'recall') {
      const branchId = args[1];
      if (!branchId || branchId.trim() === '') {
        console.error("Branch ID cannot be empty");
        exitCode = 1;
      } else {
        const db = readDb();
        const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
        if (!branchObj) {
          console.error(`Branch '${branchId}' not found`);
          exitCode = 1;
        } else {
          const allFacts = recallFacts(branchObj.id, db);
          console.log(JSON.stringify(allFacts));
        }
      }
    } else {
      console.error(`Unknown command: ${command}`);
      exitCode = 1;
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    releaseLock(lockDir);
  }

  process.exit(exitCode);
}
```

---

### Issue 5: Windows Command Injection Risk & Process Orphaning on Timeout in `lib/memory/memfork.ts`

#### 1. Problem Analysis
1. Spawning child processes with `shell: true` on Windows allows malicious branch names containing metacharacters (e.g. `&`, `|`) to execute injected shell commands.
2. In addition, when execution times out, calling `child.kill()` on Windows terminates only the `cmd.exe` wrapper, leaving the underlying Node process running (process orphaning).

#### 2. Concrete Design & Code Fix
1. Set `shell: false` whenever spawning a direct executable (like `'node'`).
2. Add input validation/sanitization to reject branch names with potential shell metacharacters `[&|<>^%]`.
3. If a shell wrapper MUST be run on Windows (such as the fallback batch script when `MEMFORK_CLI_PATH` is not set), execute `taskkill` to clean up the entire process tree on timeout.

```typescript
// Updated runMemforkCommand in lib/memory/memfork.ts
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

    // Determine if shell is strictly necessary (only for .cmd / .bat fallback files on Windows)
    const useShell = process.platform === 'win32' && executable !== 'node';
    
    // Sanitize arguments against Windows CMD metacharacters if running in shell
    if (useShell) {
      const shellMetas = /[&|<>^%]/;
      for (const arg of spawnArgs) {
        if (shellMetas.test(arg)) {
          return reject(new Error('Potential shell injection detected in arguments'));
        }
      }
    }

    const child = spawn(executable, spawnArgs, {
      env: { ...process.env },
      shell: useShell
    });

    let stdout = '';
    let stderr = '';

    const timeout = 10000;
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        try {
          // Forcefully kill child process and all its children recursively
          spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
        } catch (_) {
          child.kill();
        }
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
```

---

### Issue 6: Fact Loss During Conflict Resolution in `lib/memory/merge.ts`

#### 1. Problem Analysis
When merge conflicts are detected and resolved facts are supplied, the facts committed to the merge commit are currently calculated as:
```typescript
mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
```
This entirely bypasses the `else` block containing the `uniqueB` facts from the source branch. As a result, all unique, non-conflicting facts asserted on the source branch are discarded, resulting in silent data loss.

#### 2. Concrete Design & Code Fix
Combine the resolved facts with the unique, non-conflicting facts of the source branch. The non-conflicting source facts are calculated by filtering out the conflicting facts from `diff.uniqueB`.

```typescript
// Refactored fact merge logic in lib/memory/merge.ts
  let mergeFacts: string[] = [];
  if (conflicts.length > 0) {
    const diff = diffFacts(factsTarget, factsSource);
    
    // Identify all facts that were part of a conflict
    const conflictingFacts = new Set<string>();
    for (const c of conflicts) {
      conflictingFacts.add(normalizeFact(c.factA));
      conflictingFacts.add(normalizeFact(c.factB));
    }

    // Filter unique source facts to exclude the ones that collided
    const nonConflictingSourceFacts = diff.uniqueB.filter(
      (f) => !conflictingFacts.has(normalizeFact(f))
    );

    // Merge resolved inputs and non-conflicting source facts, avoiding target duplicates
    mergeFacts = [
      ...resolvedFacts.filter((f) => !factsTarget.includes(f)),
      ...nonConflictingSourceFacts
    ];
  } else {
    const diff = diffFacts(factsTarget, factsSource);
    mergeFacts = diff.uniqueB;
  }
```

---

### Issue 7: Missing `mergeProposals` Validation in `validateSchema`

#### 1. Problem Analysis
The `DatabaseSchema` interface requires `mergeProposals: MergeProposal[]`. However, `validateSchema` in `lib/db/db.ts` does not verify the presence or format of this array. If a user loads an older database that lacks this field, it passes validation but crashes with a runtime `TypeError` on subsequent push operations (e.g. `db.mergeProposals.push(...)`).

#### 2. Concrete Design & Code Fix
Add strict validation checks for `mergeProposals` and its containing array entries inside `validateSchema`.

```typescript
// Updated validateSchema in lib/db/db.ts
export function validateSchema(db: DatabaseSchema): boolean {
  if (!db || typeof db !== 'object') return false;
  if (!Array.isArray(db.branches)) return false;
  if (!Array.isArray(db.commits)) return false;
  if (!Array.isArray(db.messages)) return false;
  if (!Array.isArray(db.mergeProposals)) return false; // Assert presence of array
  
  // Validate branches
  for (const b of db.branches) {
    if (typeof b.id !== 'string' || typeof b.name !== 'string') return false;
    if (b.parentBranchId !== null && typeof b.parentBranchId !== 'string') return false;
  }
  
  // Validate commits
  for (const c of db.commits) {
    if (typeof c.id !== 'string' || typeof c.branchId !== 'string' || typeof c.message !== 'string') return false;
    if (!Array.isArray(c.facts) || c.facts.some(f => typeof f !== 'string')) return false;
    if (c.parentCommit !== null && typeof c.parentCommit !== 'string') return false;
    if (typeof c.timestamp !== 'number') return false;
  }

  // Validate messages
  for (const m of db.messages) {
    if (typeof m.id !== 'string' || typeof m.branchId !== 'string' || typeof m.content !== 'string') return false;
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return false;
    if (m.agentType !== undefined && m.agentType !== null && typeof m.agentType !== 'string') return false;
    if (typeof m.timestamp !== 'number') return false;
  }

  // Validate mergeProposals (New Check)
  for (const mp of db.mergeProposals) {
    if (typeof mp.id !== 'string' || typeof mp.sourceBranchId !== 'string' || typeof mp.targetBranchId !== 'string') return false;
    if (mp.status !== 'CONFLICT' && mp.status !== 'RESOLVED') return false;
    if (typeof mp.timestamp !== 'number') return false;
    if (!Array.isArray(mp.conflicts)) return false;
    for (const c of mp.conflicts) {
      if (typeof c.factA !== 'string' || typeof c.factB !== 'string' || typeof c.reason !== 'string' || typeof c.severity !== 'string') return false;
    }
  }

  return true;
}
```

---

## E2E Sandbox Recommendations

To ensure E2E sandbox execution strictly isolated environment variables (per `TEST_INFRA.md`), the E2E runner in `scripts/run-e2e.js` should explicitly configure `process.env.NODE_ENV = 'test'`.
To reduce semantic false positives in `lib/memory/merge.ts` detectConflicts, negations (like `"no"`) should be matched using word boundary regexes (`\bno\b`) to prevent keywords like `"Node"` or `"PostgreSQL"` from triggering contradiction warnings.

---

## Handoff Report

### 1. Observation
- **Lost Update**: `lib/db/db.ts` contains separate reader and writer promises queued via `enqueue` (line 63 and line 108), but mutations in `addBranch` (line 122) execute reads and writes separately:
  ```typescript
  const db = await readDb();
  ...
  await writeDb(db);
  ```
- **Branch Isolation**: `scripts/mock-memfork.js` (line 185) retrieves commits simply by branchId path matching:
  ```javascript
  const branchCommits = db.commits.filter(c => c.branchId === bId);
  ```
- **Hyphen CLI Facts**: `scripts/mock-memfork.js` (line 128) breaks argument parsing on hyphens:
  ```javascript
  if (args[i].startsWith('-')) break;
  ```
- **Command Injection / Orphaning**: `lib/memory/memfork.ts` (line 28) uses `shell: process.platform === 'win32'` without escaping.
- **Fact Loss**: `lib/memory/merge.ts` (line 241) discards non-conflicting facts:
  ```typescript
  mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
  ```
- **validateSchema**: `lib/db/db.ts` (line 31) has no assertions for `db.mergeProposals`.

### 2. Logic Chain
- Memory/process race conditions arise because multiple reads retrieve the same state before any write completes, leading to overwriting and EPERM clashes on `.tmp`. Using an atomic transactional wrapper (`updateDb`) and OS-level file locking (`fs.mkdirSync`) guarantees single-threaded serialize-exclusive modifications.
- Branch isolation fails since parent branch commits made after branching are retrieved. Storing `forkCommitId` at creation and walking the parent commit pointers resolves it.
- Bullet/hyphenated facts fail because of the naive `startsWith('-')` rule. Whitelisting known flags allows parsing custom hyphenated facts.
- Unsanitized parameters with `shell: true` trigger script injection. Disabling the shell on direct executable calls and tree-killing on timeouts closes the exploit vector.
- Manual merge resolutions overwrite non-conflicting changes. Identifying and merging non-colliding source facts prevents data loss.

### 3. Caveats
- The process-level lock cleanup is set to a 15-second age-based stale lockout. If database operations take longer than 15 seconds (highly unlikely for simple CLI tasks), the lock could be broken.

### 4. Conclusion
Applying the transactional database wrapper, process-level locks, positional command parsing, recursive DAG commit traversal, and process-tree termination solves the 7 Milestone 1 defects.

### 5. Verification Method
1. Verify memory race fix using 100 concurrent writes (`Promise.all` calling `addBranch` or `addCommit`) and assert `branches.length` increments correctly.
2. Verify process race fix by running the test suite on Windows concurrently (`scripts/run-e2e.js`) and validating zero `EPERM` / `ENOENT` / lockouts occur.
3. Verify DAG isolation by adding commits to a parent branch after branching, and ensuring `recall` on the child does not contain them.
4. Verify command injection by attempting to execute `feat&calc` branch names and validating that they fail/escape.
