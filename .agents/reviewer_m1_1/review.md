# Review Report — Milestone 1 Reviewer 1

**Verdict**: REQUEST_CHANGES

---

## Review Summary

This review assesses the codebase correctness, TypeScript type-safety, and interface contract adherence of the implemented Milestone 1 files. While the code is well-structured, follows TypeScript standards, and includes schema validations and recovery strategies, we have identified **critical concurrency and correctness flaws** that prevent approval. 

Specifically:
1. The JSON database helper (`lib/db/db.ts`) suffers from a **lost update race condition** under concurrent operations.
2. The mock CLI (`scripts/mock-memfork.js`) and merge engine (`lib/memory/merge.ts`) **violate branch isolation** by pulling in parent commits added after a fork occurs.
3. The mock CLI wrapper's command parsing truncates facts that start with hyphens/dashes.

---

## Findings

### [Critical] Finding 1: Lost Update Concurrency Race Condition in DB Helper
- **What**: The local database helper is not atomic for write/update operations, leading to lost updates under concurrency.
- **Where**: `lib/db/db.ts` (specifically inside `addBranch`, `addCommit`, `addMessage`, and the `enqueue` queue).
- **Why**: 
  The file implements a global queue `enqueue` to serialize reads and writes separately. However, update helpers perform a **read-modify-write** cycle outside of a single transaction lock:
  ```typescript
  const db = await readDb(); // enqueues read
  // ... modifies db synchronously ...
  await writeDb(db); // enqueues write
  ```
  When 100 concurrent writes are triggered (e.g. in `tests/e2e/tier2_boundary.test.js` Case 2.6.2):
  1. All 100 `readDb` calls queue up sequentially. They all execute and read the *unmodified* file from disk.
  2. Each concurrent call pushes its new branch to its own local `db` reference.
  3. They all queue up `writeDb` calls.
  4. The writes execute sequentially, each overwriting the previous file. The final write wins, and the other 99 writes are lost.
  The assertion `assert.strictEqual(finalDb.branches.length, 100 + 1)` in Case 2.6.2 will fail, returning a length of `2` instead of `101`.
- **Suggestion**: 
  Implement an atomic update helper, such as `updateDb(updateFn: (db: DatabaseSchema) => void | Promise<void>)`, which wraps both the read, modification, and write inside a single task enqueued on the promise chain:
  ```typescript
  export async function updateDb(updateFn: (db: DatabaseSchema) => void | Promise<void>): Promise<void> {
    return enqueue(async () => {
      const db = await readDbInternal(); // read without enqueuing separately
      await updateFn(db);
      await writeDbInternal(db); // write without enqueuing separately
    });
  }
  ```

### [Major] Finding 2: Branch Isolation Violation in Recall (Mock CLI & Merge)
- **What**: Recalling a branch retrieves parent branch commits that were added *after* the fork occurred, violating branch isolation.
- **Where**: `scripts/mock-memfork.js` (lines 183-194) and `lib/memory/merge.ts` (lines 183-194).
- **Why**: 
  To recall facts, the code resolves the lineage of branches (e.g. `main` -> `feature-a`) and queries *all* commits belonging to those branch IDs. However, if a new commit is added to `main` *after* `feature-a` was created, that commit's facts are pulled into `recall("feature-a")`.
  In a git-like branch system, a child branch must only inherit commits present on the parent *at the time of branching*. It should trace history backwards from the branch head using `parentCommit` pointers rather than query-filtering branch IDs.
- **Suggestion**: 
  Instead of path-traversing branch IDs and querying all commits, traverse the DAG backwards from the head commit of the target branch using the `parentCommit` pointers.

### [Minor] Finding 3: CLI Fact Truncation on Dashes in Mock CLI
- **What**: Facts that start with a hyphen or dash (e.g. `"- Postgres supports scaling"`) are truncated.
- **Where**: `scripts/mock-memfork.js` (line 128).
- **Why**: 
  The command parsing logic for facts breaks as soon as an argument starts with a dash:
  ```javascript
  if (args[i].startsWith('-')) break;
  ```
  If a fact contains a negative symbol or markdown dash, it will be treated as a flag and terminate the fact parser.
- **Suggestion**: 
  Only break fact parsing if the argument is a known CLI flag (e.g., `-m`, `--from`), or restructure argument parsing to support safe boundaries.

---

## Verified Claims

- **Filesystem Atomicity** → verified via `view_file` on `lib/db/db.ts` → **PASS** (Writes to `.tmp` and renames).
- **Directory Auto-Creation** → verified via `view_file` on `lib/db/db.ts` → **PASS** (`fs.mkdir` called with `{ recursive: true }`).
- **Database Schema Validation** → verified via `view_file` on `lib/db/db.ts` → **PASS** (`validateSchema` rejects incorrect schema models).
- **TypeScript Resolution** → verified via `view_file` on `tsconfig.json` and module imports → **PASS** (All ts paths and index files resolve properly).
- **Sandbox DB Isolation** → verified via `view_file` on `scripts/run-e2e.js` and `tests/e2e/` → **PASS** (Correctly configures `MEMFORK_DB_PATH` and performs before/after setups).

---

## Coverage Gaps

- **Cross-Process Concurrency** — Risk Level: **Medium** — The in-memory promise queue only serializes calls within a single process. Since the CLI is spawned as a child process via `child_process.spawn`, multiple concurrent CLI invocations will bypass the queue and can race. File-locking (e.g., using a lockfile library or atomic locks) is needed for multi-process safety.
- **Mock CLI Compliance** — Risk Level: **Medium** — The mock CLI has semantic differences from a real DAG-based CLI wrapper.

---

## Unverified Items

- **Actual test suite execution** — Reason not verified: Command execution permissions timed out in the headless/non-interactive workspace environment.
