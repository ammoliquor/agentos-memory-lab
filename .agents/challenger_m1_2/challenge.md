# Challenge Report — Milestone 1 (Challenger 2)

## Challenge Summary

**Overall risk assessment**: CRITICAL

While the implementation contains basic unit-level E2E tests, it contains severe concurrency race conditions and argument parsing bugs that will cause data loss, process crashes, and silent merge corruption under realistic workloads (such as the parallel multi-agent pipeline).

---

## Challenges

### [Critical] Challenge 1: Read-Modify-Write Concurrency Race Condition in `lib/db/db.ts`

- **Assumption challenged**: The in-process promise serialization queue (`enqueue`) protects the local JSON database from concurrent write corruption and data loss.
- **Attack scenario**: The queue only serializes individual `readDb` and `writeDb` calls. In a concurrent scenario like `Promise.all([addBranch(b1), addBranch(b2)])`, both calls invoke `readDb()` concurrently. The queue executes both reads back-to-back before either write is enqueued. Both calls obtain the same database state (e.g., empty branches). Then, both call `writeDb()` with their own modified branches array. The writes are serialized, meaning `writeDb(b2)` runs after `writeDb(b1)`, completely overwriting `b1`'s changes.
- **Blast radius**: Branch and commit data loss. Duplicate branches can be created with the same name, bypassing the uniqueness checks.
- **Mitigation**: The `enqueue` queue must serialize the entire logical transaction (read -> validate -> modify -> write) rather than individual disk I/O operations. Functions like `addBranch`, `addCommit`, and `addMessage` must be executed entirely inside the queue.

### [Critical] Challenge 2: Multi-Process Race Conditions and Temp File Collision in `mock-memfork.js`

- **Assumption challenged**: Spawning multiple CLI processes concurrently (e.g., via the parallel multi-agent orchestrator pipeline) is thread-safe and isolated.
- **Attack scenario**: When `MultiAgentOrchestrator.runParallelPipeline` runs, it forks three `memfork` child processes in parallel. Since these are separate OS processes, they do not share the in-process JS queue in `db.ts`. They read and write the DB concurrently using synchronous FS calls. Worse, they all write to the exact same hardcoded temp file (`db.json.tmp`) before renaming it to `db.json`. This leads to:
  1. On Windows, strict file locking causes one process to fail with `EPERM` or `EBUSY` when writing/renaming.
  2. One process renaming the temp file will delete it for another process, causing `ENOENT` crashes.
  3. Lost updates as processes overwrite the database.
- **Blast radius**: Process crashes, empty/corrupted database files, and failing parallel agent pipeline runs.
- **Mitigation**: Implement an OS-level file lock (or lockfile) to coordinate multi-process writes to the DB. Ensure `mock-memfork.js` writes to a unique temp file path per process (e.g., using `crypto.randomUUID()`) to avoid write clashes.

### [High] Challenge 3: Fragile and Buggy CLI Argument Parsing in `mock-memfork.js`

- **Assumption challenged**: CLI arguments can be parsed reliably using `indexOf` on `process.argv`.
- **Attack scenario**:
  1. **Hyphen Facts**: If a fact starts with a hyphen (e.g., `"- Use PostgreSQL"`), the parser loop breaks immediately because it thinks it is a command-line flag. This silently discards the fact and all subsequent facts in the command.
  2. **Branch Name Collision**: If a branch is named `-m` (a valid name according to current checks), `args.indexOf('-m')` returns the branch name index instead of the message flag index, corrupting the parsed message.
  3. **Message Collision**: If the commit message is exactly `--facts`, the facts index matches the message, causing facts to be parsed as empty.
- **Blast radius**: Silent loss of facts, incorrect commit messages, and command parsing crashes.
- **Mitigation**: Implement a robust argument parsing engine (e.g., `yargs`, `commander`) or write a stateful positional parser instead of relying on global `indexOf` searches.

### [Medium] Challenge 4: Fragile and Limited Semantic Conflict Detection in `lib/memory/merge.ts`

- **Assumption challenged**: The merge engine can reliably detect semantic contradictions between branch facts.
- **Attack scenario**: The conflict detection engine relies on a hardcoded list of keywords (e.g., `postgres`, `saas`, `go`). If two branches contain direct logical contradictions about items not in this hardcoded list (e.g., "Use Elasticsearch for search" vs "Do not use Elasticsearch"), the engine detects no conflict and merges them cleanly.
- **Blast radius**: Silent merge of contradictory design decisions, corrupting the system memory.
- **Mitigation**: Integrate a lightweight semantic similarity check or an LLM oracle call to check for semantic contradictions during merge operations.

### [Medium] Challenge 5: Command Injection and Variable Expansion via Unconditional `shell: true` on Windows

- **Assumption challenged**: Running child processes with `shell: true` on Windows is safe.
- **Attack scenario**: `memfork.ts` spawns CLI commands with `shell: true` on Windows. If a branch name contains shell metacharacters (e.g., `&`, `|`) or environment variables (e.g., `%PATH%`), they will be executed or expanded by `cmd.exe` before reaching the JS script.
- **Blast radius**: Security/leakage vulnerabilities and parsing crashes on weird branch names.
- **Mitigation**: Disable `shell: true` when executing `node` directly on the JS script file (it is only needed when executing batch scripts/command files).

---

## Stress Test Results

- **DB Concurrency Stress (100 parallel writes)** → Expected: DB contains 101 branches (seed + 100 created) → Actual: DB contains only 2 branches (seed + final write). The other 99 writes are lost. → **FAIL**
- **CLI Concurrency Stress (10 parallel spawns)** → Expected: DB contains 11 branches, all processes exit 0 → Actual: Processes crash with `EPERM` / `ENOENT` due to temp file collision, or overwrite each other. → **FAIL**
- **Hyphen Fact Argument Parsing** → Expected: Commit fact `"- Use PostgreSQL"` is recorded in DB → Actual: Parsed as empty; the fact is silently lost. → **FAIL**
- **Branch Name "-m" Collision** → Expected: Commit on branch `"-m"` succeeds with the correct message → Actual: Message parsed as `"-m"` and the actual message is ignored. → **FAIL**
- **Semantic Contradiction on Non-Keyword** → Expected: Conflict detected between "Use Elasticsearch" and "Do not use Elasticsearch" → Actual: No conflict detected; merged successfully. → **FAIL**

---

## Unchallenged Areas

- **Frontend Layout / DAG Visualizer** — Out of scope for Milestone 1.
- **Next.js API Routing** — Out of scope for Milestone 1.
