# Handoff Report — Explorer 1 Gen 2 (Milestone 1)

## 1. Observation
- **Concurrency (Memory-Level)**: In `lib/db/db.ts` (lines 122–129, 139–143, 153–157), database updates read the database, modify the returned JSON object in-memory, and then write it back to disk. These operations are not wrapped in a single promise transaction.
- **Concurrency (Process-Level)**: Spawning multiple parallel processes of `scripts/mock-memfork.js` (E2E run tier tests) accesses the same DB file synchronously via `fs.readFileSync` and `fs.writeFileSync` using a hardcoded temporary file `dbPath + '.tmp'` (lines 20-59), causing Windows file lockouts (`EPERM`) and race conditions.
- **Branch Isolation**: `scripts/mock-memfork.js` (lines 183-194) and `lib/memory/merge.ts` (lines 183-194) recall facts by querying commits belonging to branch IDs, ignoring commit DAG creation sequence.
- **CLI Fact Truncation**: In `scripts/mock-memfork.js` (line 128), facts parsing terminates on any argument beginning with `-`:
  ```javascript
  if (args[i].startsWith('-')) break;
  ```
- **Windows Command Injection**: In `lib/memory/memfork.ts` (lines 26-29), processes are executed with `shell: process.platform === 'win32'` without parameter sanitation, allowing metacharacter command execution. Process timeouts (line 36) only terminate the shell, leaving Node background processes orphaned.
- **Fact Loss**: In `lib/memory/merge.ts` (lines 239-245), merge commits discard non-conflicting unique source facts when resolving conflicts.
- **Missing validation**: In `lib/db/db.ts` (line 31), `validateSchema` lacks verification check for the `mergeProposals` array.

## 2. Logic Chain
- Non-atomic database updates allow concurrent reads to resolve to the same initial state, causing subsequent writes to overwrite and discard previous changes (Observation 1). Serializing reads and writes together inside a promise queue transaction ensures data consistency.
- Parallel processes clash when writing to the same hardcoded `.tmp` file (Observation 2). Introducing a cross-process lock via atomic directory creation (`fs.mkdir` / `fs.mkdirSync`) and generating unique temporary files (`crypto.randomUUID()`) avoids concurrent file collisions.
- Fact recall fetches parent commits added after the fork because it filters commits strictly by branchId (Observation 3). Storing `forkCommitId` at branch creation and traversing backwards along `parentCommit` pointers maps to Git-like branch isolation.
- Whitelisting known CLI flags preventing termination on hyphens allows bulleted/hyphenated facts to be captured (Observation 4).
- Setting `shell: false` for direct node calls and sanitizing arguments containing `[&|<>^%]` prevents command injection. Recurse-killing the process tree via `taskkill /pid /T /F` prevents orphaned processes (Observation 5).
- Resolving conflicts must not lose other source changes. Extracting non-conflicting facts and combining them with manual resolutions preserves correct state (Observation 6).
- Validating the `mergeProposals` array prevents Next.js actions from hitting runtime crashes (Observation 7).

## 3. Caveats
- The process-level lock handles stale files by checking the modification timestamp. If operations take longer than 15 seconds, the lock could be preemptively deleted.

## 4. Conclusion
Fixing the 7 issues requires implementing the atomic transactional DB wrapper, cross-process directory lock files, positional command argument parsing, parent-pointer DAG commit traversal, input sanitization, and non-conflicting source fact retention.

## 5. Verification Method
1. Run `node scripts/run-e2e.js` to run the E2E test suite.
2. Verify that 100 concurrent writes to the database do not result in overwritten branches.
3. Validate that recall returns only facts in the ancestral path of the commit DAG.
4. Verify command arguments containing shell metacharacters fail sanitization.
