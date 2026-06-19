## 2026-06-18T22:21:47Z

You are the Worker Gen 2 for Milestone 1.
Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\worker_m1_gen2.
Your task is to implement the fixes for Milestone 1 codebase and tests.

### Inputs:
1. C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m1_2_gen2\analysis.md (Detailed fix designs)
2. C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m1_3_gen2\analysis.md (Detailed fix designs)
3. Existing files: `lib/db/db.ts`, `lib/memory/memfork.ts`, `lib/memory/merge.ts`, `lib/types/index.ts`, `scripts/mock-memfork.js`, `scripts/run-e2e.js`, `scripts/verify-project.js`, `tests/e2e/tier1_feature.test.js`, `tests/e2e/tier2_boundary.test.js`.

### Objectives:
1. **Local DB Transaction Queue & Locking (`lib/db/db.ts`)**:
   - Refactor `readDb` and `writeDb` to run inside a serialized transaction update helper `updateDb(updater: (db: DatabaseSchema) => void | Promise<void>)` enqueued in the promise chain.
   - Implement process-level locking via atomic directory creation (`db.json.lock` using `fs.mkdir`/`fs.rmdir`) with retry delays (randomized 20-50ms backoffs, 10s timeout, and 10s stale lock cleaning).
   - Write temp files to a process-unique temp path (e.g. `db.json.<randomUUID>.tmp`) before renaming, preventing file collisions on Windows.
   - Refactor `addBranch`, `addCommit`, `addMessage`, `resetDb` to execute their entire read-modify-write cycle inside `updateDb`.
2. **Database Schema Update (`lib/types/index.ts` and `validateSchema`)**:
   - Extend `Branch` interface to support an optional/nullable `forkCommitId` (string | null).
   - Update `validateSchema` to check the `mergeProposals` array (and its nested conflict items) and branch `forkCommitId` checks. Ensure `readDb` initializes `mergeProposals = []` if not present in older databases before validating, protecting backward compatibility.
3. **Mock CLI Refactoring (`scripts/mock-memfork.js`)**:
   - Implement matching synchronous directory locking (`db.json.lock`) with retry loops and stale lock cleanup, and unique temp files for database writes.
   - Implement stateful positional CLI argument parsing for `commit` (iterate through `process.argv` sequentially, skipping over flag values) so facts starting with a hyphen (like markdown lists) are parsed correctly and do not collide with flags like `-m`.
   - When creating a branch (`branch`), find the parent branch's head commit and record its ID in `forkCommitId`.
   - When committing, if the branch has no commits, set `parentCommit` to the branch's `forkCommitId`.
   - When recalling (`recall`), perform a DAG backward traversal starting from the branch's head commit via `parentCommit` pointers (handling comma-separated lists for merges and keeping a visited set to avoid cycles). Chronologically sort collected commits to maintain fact insertion order.
4. **Merge Engine Update (`lib/memory/merge.ts`)**:
   - Update `recallFacts` to use the same backwards DAG traversal (walking `parentCommit` pointers from branch's head commit, avoiding cycles).
   - In `mergeBranches`, if conflicts exist and resolutions are provided, calculate facts to keep by combining the manual resolutions and the unique non-conflicting facts from the source branch (filtering out source facts involved in conflicts).
   - Restrict conflict checks in `mergeBranches` to only newly added unique facts (`diff.uniqueA` vs `diff.uniqueB`) to avoid re-triggering conflicts on previously resolved facts.
   - In `detectConflicts`, refine keyword matches (negations) to use exact word boundaries (e.g., `/\bno\b/i`, `/\bdo not\b/i`) to prevent false-positive matches (like "node", "normal", "now").
5. **CLI Wrapper Security & Robustness (`lib/memory/memfork.ts`)**:
   - Remove `shell: true` and spawn child processes with `shell: false` (since it is a Node script, spawn it directly as `node` with script arguments). This prevents shell injection and process orphaning on Windows.
   - Validate branch names strictly against `/^[a-zA-Z0-9-_]+$/` before spawning.
   - On process execution timeout, terminate the process tree on Windows using `taskkill /pid ... /f /t`.
6. **E2E Test Runner (`scripts/run-e2e.js`)**:
   - Inject `process.env.NODE_ENV = 'test'` in the environment sandbox setup.
7. **Verification**:
   - Try to compile and run tests (`node scripts/verify-project.js`) to ensure all 26+ E2E tests pass.
