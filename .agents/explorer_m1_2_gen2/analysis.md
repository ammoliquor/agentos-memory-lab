# Bug Analysis & Fix Strategy Report — Milestone 1

This report details the root causes and actionable, robust fix strategies for the seven critical issues identified during the first verification iteration of Milestone 1.

---

## 1. Concurrency Lost-Update Race Condition

### Observation & Root Cause
In `lib/db/db.ts`, functions that mutate the database (`addBranch`, `addCommit`, `addMessage`, `resetDb`) perform a non-atomic read-modify-write cycle:
```typescript
const db = await readDb(); // Enqueues and runs a read task
// ... modifies db in-memory ...
await writeDb(db); // Enqueues and runs a write task
```
Although individual read and write operations are serialized via the in-memory `enqueue` promise chain, concurrent operations (e.g. `Promise.all`) schedule all reads first. They all read the same stale state from disk, perform their respective modifications in-memory, and then sequentially write their states, resulting in all but the last write being silently lost.

### Fix Strategy
Implement a unified transaction helper `updateDb(updater)` that enqueues the entire read-modify-write cycle as a single atomic task in the serialization queue.

#### Proposed Changes in `lib/db/db.ts`
1. Split `readDb` and `writeDb` into internal synchronous/asynchronous logic that runs without enqueuing:
```typescript
async function readDbInternal(): Promise<DatabaseSchema> {
  const dbPath = getDbPath();
  try {
    const content = await fs.readFile(dbPath, 'utf8');
    const parsed = JSON.parse(content) as DatabaseSchema;
    if (!parsed.mergeProposals) {
      parsed.mergeProposals = [];
    }
    if (!validateSchema(parsed)) {
      throw new Error('Invalid schema in readDb');
    }
    return parsed;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      const tempPath = `${dbPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      await fs.rename(tempPath, dbPath);
      return defaultDb;
    }
    // Corrupted file backup logic...
    throw error;
  }
}

async function writeDbInternal(db: DatabaseSchema): Promise<void> {
  if (!validateSchema(db)) {
    throw new Error('Invalid database schema');
  }
  const dbPath = getDbPath();
  const tempPath = `${dbPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tempPath, dbPath);
}
```
2. Define `readDb` and `writeDb` as public enqueued functions:
```typescript
export async function readDb(): Promise<DatabaseSchema> {
  return enqueue(() => readDbInternal());
}

export async function writeDb(db: DatabaseSchema): Promise<void> {
  return enqueue(() => writeDbInternal(db));
}
```
3. Add the transaction helper `updateDb`:
```typescript
export async function updateDb(updater: (db: DatabaseSchema) => void | Promise<void>): Promise<void> {
  return enqueue(async () => {
    const db = await readDbInternal();
    await updater(db);
    await writeDbInternal(db);
  });
}
```
4. Refactor mutating functions to use `updateDb`:
```typescript
export async function addBranch(branch: Branch): Promise<void> {
  return updateDb((db) => {
    if (db.branches.some(b => b.name === branch.name || b.id === branch.id)) {
      throw new Error(`Branch with name "${branch.name}" or ID "${branch.id}" already exists`);
    }
    db.branches.push(branch);
  });
}
// Apply similar changes to addCommit, addMessage, and resetDb.
```

---

## 2. Multi-Process Write Collisions & Lockouts

### Observation & Root Cause
When the parallel multi-agent orchestrator runs, it spawns multiple independent processes running `scripts/mock-memfork.js`.
1. **Temp File Collisions**: Processes write to a hardcoded temp file (`db.json.tmp`), causing `EPERM` or `EBUSY` crashes on Windows when renaming concurrently.
2. **Cross-Process Race Conditions**: The separate OS processes bypass the in-memory JS queue in `db.ts`, reading and overwriting `db.json` concurrently.

### Fix Strategy
1. **Dynamic Temp Files**: Use unique temp files per write using random suffixes.
2. **Atomic File Locking**: Implement an advisory locking mechanism using atomic exclusive file creation (`flag: 'wx'`).

#### Proposed Lock Implementation for `scripts/mock-memfork.js` (Synchronous)
```javascript
function acquireLockSync(lockPath) {
  const timeout = 5000;
  const interval = 50;
  const start = Date.now();
  while (true) {
    try {
      fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start > timeout) {
        throw new Error('Lock acquisition timeout');
      }
      const waitTill = Date.now() + interval;
      while (Date.now() < waitTill) {} // Busy wait
    }
  }
}

function releaseLockSync(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_) {}
}
```
Wrap the database read-modify-write blocks of `branch` and `commit` commands in a `try...finally` block that manages the lock.

#### Proposed Lock Implementation for `lib/db/db.ts` (Asynchronous)
```typescript
async function acquireLockAsync(lockPath: string): Promise<void> {
  const timeout = 5000;
  const interval = 50;
  const start = Date.now();
  while (true) {
    try {
      await fs.writeFile(lockPath, process.pid.toString(), { flag: 'wx' });
      return;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start > timeout) {
        throw new Error('Lock acquisition timeout');
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
}

async function releaseLockAsync(lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch (_) {}
}
```
Integrate the lock in `updateDb` inside `lib/db/db.ts`:
```typescript
export async function updateDb(updater: (db: DatabaseSchema) => void | Promise<void>): Promise<void> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    const lockPath = dbPath + '.lock';
    await acquireLockAsync(lockPath);
    try {
      const db = await readDbInternal();
      await updater(db);
      await writeDbInternal(db);
    } finally {
      await releaseLockAsync(lockPath);
    }
  });
}
```

---

## 3. Branch Isolation Recall Violation (DAG Traversal)

### Observation & Root Cause
In `scripts/mock-memfork.js` and `lib/memory/merge.ts`, `recall` resolves branch lineage using `parentBranchId` and collects all commits belonging to those branch IDs. If a parent branch (e.g. `main`) receives new commits *after* the child branch was created, those new commits leak into the child branch's recall output. Additionally, the first commit on a child branch does not set its `parentCommit` correctly.

### Fix Strategy
1. **Continuous DAG Linkage**: When committing, if a branch has no commits of its own, walk up its `parentBranchId` ancestry to find the head commit of the closest parent branch, and set that as `parentCommit`.
2. **Backwards DAG Traversal**: Walk the commit tree backwards from the branch's head commit using the `parentCommit` pointers (supporting comma-separated merge parents and avoiding cycles).

#### Proposed Helper Functions (`scripts/mock-memfork.js` & `lib/memory/merge.ts`)
```javascript
function getBranchHeadCommit(db, branchId, visited = new Set()) {
  if (visited.has(branchId)) return null;
  visited.add(branchId);

  const branchCommits = db.commits.filter(c => c.branchId === branchId);
  if (branchCommits.length > 0) {
    branchCommits.sort((a, b) => a.timestamp - b.timestamp);
    return branchCommits[branchCommits.length - 1];
  }
  const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
  if (branchObj && branchObj.parentBranchId) {
    return getBranchHeadCommit(db, branchObj.parentBranchId, visited);
  }
  return null;
}

function recallFactsFromHead(db, headCommitId) {
  const visited = new Set();
  const commitsToCollect = [];
  const queue = [headCommitId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    const commit = db.commits.find(c => c.id === currentId);
    if (commit) {
      commitsToCollect.push(commit);
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(',');
        for (const p of parents) {
          queue.push(p.trim());
        }
      }
    }
  }

  // Sort chronologically to maintain fact generation order
  commitsToCollect.sort((a, b) => a.timestamp - b.timestamp);

  const allFacts = [];
  for (const commit of commitsToCollect) {
    for (const fact of commit.facts) {
      if (!allFacts.includes(fact)) {
        allFacts.push(fact);
      }
    }
  }
  return allFacts;
}
```

When committing on branch $B$:
```javascript
const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
let parentCommit = null;
if (branchCommits.length > 0) {
  branchCommits.sort((a, b) => a.timestamp - b.timestamp);
  parentCommit = branchCommits[branchCommits.length - 1].id;
} else if (branchObj.parentBranchId) {
  const parentHead = getBranchHeadCommit(db, branchObj.parentBranchId);
  if (parentHead) {
    parentCommit = parentHead.id;
  }
}
```

---

## 4. CLI Facts Argument Parsing Truncation

### Observation & Root Cause
In `scripts/mock-memfork.js`, the commit parser terminates as soon as any argument starts with a hyphen to avoid capturing trailing options:
```javascript
if (args[i].startsWith('-')) break;
```
This truncates negative values, markdown list items (e.g. `"- PostgreSQL supports scaling"`), or hyphenated strings. Also, the parser relies on global `indexOf` queries, causing collisions on branch names like `-m`.

### Fix Strategy
Implement a stateful parser in `scripts/mock-memfork.js` that scans arguments positionally, jumping over option values, and allowing hyphenated facts.

#### Proposed Stateful Positional Parser
```javascript
const command = args[0];

if (command === 'commit') {
  const branchId = args[1];
  let message = null;
  let facts = [];
  let parsingFacts = false;

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m') {
      message = args[i + 1];
      i++; // Skip message value
      parsingFacts = false;
    } else if (arg === '--facts') {
      parsingFacts = true;
    } else if (parsingFacts) {
      if (arg === '-m') {
        message = args[i + 1];
        i++;
        parsingFacts = false;
      } else {
        facts.push(arg);
      }
    }
  }
  // Validate presence of branchId and message ...
}
```

---

## 5. Windows Command Injection & Process Orphaning

### Observation & Root Cause
1. **Shell Injection**: `lib/memory/memfork.ts` spawns commands using `shell: true` on Windows, which allows executing command injection payloads embedded in branch names (e.g., `feat&calc`).
2. **Orphaned Timeout Processes**: `child.kill()` on Windows only kills the outer `cmd.exe` process, leaving the child Node process running.

### Fix Strategy
1. **Disable shell**: Only use `shell: true` when running global batch files. For the standard path where `node` executes `mock-memfork.js`, execute without a shell.
2. **Branch Name Validation**: Assert branch names conform to a strict safe pattern: `/^[a-zA-Z0-9._/\-]+$/`.
3. **Taskkill Process Tree**: Use `taskkill` on Windows timeouts to terminate the entire process tree.

#### Proposed Changes in `lib/memory/memfork.ts`
1. Validate branch name:
```typescript
if (!/^[a-zA-Z0-9._/\-]+$/.test(name)) {
  throw new Error('Invalid branch name. Only alphanumeric, dot, underscore, dash, and slashes are allowed.');
}
```
2. Spawn configuration:
```typescript
const useShell = executable !== 'node' && process.platform === 'win32';
const child = spawn(executable, spawnArgs, {
  env: { ...process.env },
  shell: useShell
});
```
3. Process Tree termination:
```typescript
const timer = setTimeout(() => {
  if (process.platform === 'win32') {
    // Forcefully kill the process and all child processes recursively
    spawn('taskkill', ['/pid', child.pid!.toString(), '/f', '/t']);
  } else {
    child.kill();
  }
  reject(new Error('CLI execution timeout'));
}, timeout);
```

---

## 6. Fact Loss During Conflict Resolution

### Observation & Root Cause
In `mergeBranches` (`lib/memory/merge.ts`), when a conflict is detected and resolved manually, the merge facts are defined strictly as:
```typescript
mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
```
This ignores the non-conflicting unique facts of the source branch (`diff.uniqueB`), resulting in severe data loss.

### Fix Strategy
Calculate the source's conflicting facts based on the detected `conflicts` list, filter them out from the unique source facts, and merge the remaining non-conflicting source facts along with the `resolvedFacts`.

#### Proposed Changes in `lib/memory/merge.ts`
```typescript
let mergeFacts: string[] = [];
if (conflicts.length > 0) {
  // Extract all source facts involved in a conflict
  const conflictingSourceFacts = new Set(conflicts.map(c => c.factB));
  const diff = diffFacts(factsTarget, factsSource);
  // Include non-conflicting unique source facts
  const nonConflictingUniqueSource = diff.uniqueB.filter(f => !conflictingSourceFacts.has(f));

  mergeFacts = [
    ...resolvedFacts.filter(f => !factsTarget.includes(f)),
    ...nonConflictingUniqueSource
  ];
} else {
  const diff = diffFacts(factsTarget, factsSource);
  mergeFacts = diff.uniqueB;
}
```

---

## 7. Schema Validation for `mergeProposals`

### Observation & Root Cause
`validateSchema` checks branches, commits, and messages but omits `mergeProposals`. If a database file lacks `mergeProposals` or has it corrupted, it will bypass validation, only to crash later when code tries to push to it.

### Fix Strategy
Update `validateSchema` in both `db.ts` and `mock-memfork.js` to strictly assert the presence and types of the `mergeProposals` array and its constituent elements.

#### Proposed Changes in `lib/db/db.ts`
```typescript
export function validateSchema(db: DatabaseSchema): boolean {
  if (!db || typeof db !== 'object') return false;
  if (!Array.isArray(db.branches)) return false;
  if (!Array.isArray(db.commits)) return false;
  if (!Array.isArray(db.messages)) return false;
  if (!Array.isArray(db.mergeProposals)) return false;

  // Validate merge proposals
  for (const mp of db.mergeProposals) {
    if (typeof mp.id !== 'string' || typeof mp.sourceBranchId !== 'string' || typeof mp.targetBranchId !== 'string') return false;
    if (mp.status !== 'CONFLICT' && mp.status !== 'RESOLVED') return false;
    if (!Array.isArray(mp.conflicts)) return false;
    for (const c of mp.conflicts) {
      if (typeof c.factA !== 'string' || typeof c.factB !== 'string' || typeof c.reason !== 'string') return false;
    }
    if (typeof mp.timestamp !== 'number') return false;
  }
  // Rest of validation...
  return true;
}
```

Ensure `readDbInternal` initializes `mergeProposals = []` if absent in the parsed object *before* validation to prevent wiping out legacy data.

---

## Additional Robustness: Semantic Check Negation Word Boundaries

To eliminate spurious conflict false-positives identified in Challenger Review 1, change the negation word matching in `detectConflicts` (`lib/memory/merge.ts`) to use word boundaries:
```typescript
const negationRegex = new RegExp(`\\b(${negationWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
```
Then check negation using `negationRegex.test(normA)`. This prevents words like "node", "normal", or "now" from falsely triggering negation-related contradictions.
Additionally, restrict conflict detection to check only the differences between the two branches:
```typescript
const diff = diffFacts(factsTarget, factsSource);
const conflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);
```
This isolates conflict checks to newly added facts, completely avoiding re-conflicting on already resolved hybrid facts.
