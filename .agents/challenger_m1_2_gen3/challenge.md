# Challenge Report — Milestone 1 (Challenger 2, Gen 3)

## Challenge Summary

**Overall risk assessment**: MEDIUM

The Gen 3 implementation has successfully mitigated the critical concurrency bugs and argument parsing vulnerabilities identified in previous reviews:
1. **Multi-process locking** is now implemented using directory-level locking (`dbPath + '.lock'`).
2. **Temp file collisions** are resolved by using unique UUID-based filenames (`dbPath + '.' + crypto.randomUUID() + '.tmp'`).
3. **CLI argument parsing** is now performed using a stateful parser in `scripts/mock-memfork.js` which resolves hyphen-prefixed facts and branch name collisions.

However, a medium risk remains regarding non-transactional database updates and potential stale lock cleanup races.

---

## Challenges

### [Medium] Challenge 1: Read-Modify-Write Concurrency Race Condition in `lib/db/db.ts`

- **Assumption challenged**: Callers can safely perform database updates by calling `readDb()` followed by `writeDb(db)` individually.
- **Attack scenario**: If a caller reads the database state, performs an operation, and then writes it back (as seen in `testDbConcurrency` in `tests/challenge_stress.js`), multiple concurrent promises can interleave. Since the lock is released after `readDb` and re-acquired in `writeDb`, both operations read the same initial state and overwrite each other's changes upon writing.
- **Blast radius**: Lost updates and data corruption for any DB operation that does not utilize the `updateDb` transactional wrapper.
- **Mitigation**: Deprecate or make `readDb` and `writeDb` private. Force all database modifications to go through `updateDb`, which holds the lock across the entire read-modify-write cycle.

### [Low] Challenge 2: Lock Expiry Race under Heavy Resource Starvation

- **Assumption challenged**: A lock file/directory older than 10 seconds is stale and can be safely deleted.
- **Attack scenario**: On a heavily loaded system or slow disk, a process might take slightly longer than 10 seconds to complete its write operation. Another process attempting to acquire the lock will inspect the lock's `mtimeMs`, identify it as stale (> 10s), delete it, and acquire its own lock. Both processes will then execute concurrently.
- **Blast radius**: Concurrent database modification, leading to lost updates.
- **Mitigation**: Instead of using empty directories, write the current process PID and timestamp into a lockfile. Inspecting processes can check if the PID is still active in the OS before force-deleting the lock.

---

## Stress Test Results

- **DB Concurrency Stress (100 parallel writes using non-transactional read/write)**:
  - Expected: DB contains 101 branches (seed + 100 created)
  - Actual/Predicted: DB contains 2 branches
  - Result: **FAIL** (This confirms the vulnerability in Challenge 1 is still present if the transactional wrapper is bypassed).

- **CLI Concurrency Stress (10 parallel spawns using transactional CLI)**:
  - Expected: DB contains 11 branches, all processes exit 0
  - Actual/Predicted: DB contains 11 branches, 0 crashes
  - Result: **PASS** (This confirms that the cross-process lock and UUID temp files successfully serialize concurrent CLI invocations).

- **Hyphen Fact Argument Parsing**:
  - Expected: Commit fact `"- Use PostgreSQL"` is recorded in DB
  - Actual/Predicted: Committed facts: `[ '- Use PostgreSQL', 'Normal Fact' ]`
  - Result: **PASS** (Stateful parsing successfully processes facts prefixed with hyphens).

- **Branch Name "-m" Collision**:
  - Expected: Commit on branch `"-m"` succeeds with the correct message
  - Actual/Predicted: Committed message: `"My real message"`
  - Result: **PASS** (Stateful parsing correctly distinguishes positional branch name arguments from flag arguments).

---

## Unchallenged Areas

- **Frontend Layout / DAG Visualizer**: Out of scope for Milestone 1.
- **Semantic Contradiction Logic**: Handled by Challenger 1.
