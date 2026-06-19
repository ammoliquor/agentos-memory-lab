# Handoff Report — Explorer 3 Gen 2

## 1. Observation

We directly examined the workspace codebase and the four reviewer/challenger reports:
- **`reviewer_m1_1/review.md`**: Outlined the lost-update race condition, branch isolation violation, and fact truncation on dashes.
- **`reviewer_m1_2/review.md`**: Detailed type safety gaps in `validateSchema` (missing `mergeProposals`), `NODE_ENV` configuration issues, and hang hazards from cycles.
- **`challenger_m1_1/challenge.md`**: Highlighted cross-process write race conditions, catastrophic fact loss on conflict resolution, and Windows shell metacharacter vulnerabilities.
- **`challenger_m1_2/challenge.md`**: Verified E2E concurrency failures (100 parallel writes, 10 parallel CLI spawns) and command collisions.

Codebase inspection confirmed these findings:
1. **Issue 1 (Memory Race Condition)**: In `lib/db/db.ts` (lines 122-129), functions perform independent `await readDb()` and `await writeDb()` calls. Under concurrency, reads occur concurrently and overwrite each other's changes.
2. **Issue 2 (Process Collision & Lockouts)**: `scripts/mock-memfork.js` (line 52) and `lib/db/db.ts` (line 110) use static temp file paths `const tempPath = dbPath + '.tmp'` and `const tempPath = \`\${dbPath}.tmp\`` respectively. They read and write without process-level synchronization, resulting in `EPERM` or `ENOENT` on Windows.
3. **Issue 3 (Branch Isolation Recall Violation)**: `lib/memory/merge.ts` (lines 176-181) and `scripts/mock-memfork.js` (lines 176-181) traverse parent branch paths using `parentBranchId` to retrieve all commits belonging to those branch IDs. Commits added to parent branches after the fork are leaked. Additionally, `scripts/mock-memfork.js` (lines 141-143) initializes `parentCommit` to `null` on the first commit of a child branch, breaking the commit DAG.
4. **Issue 4 (Fact Argument Truncation)**: `scripts/mock-memfork.js` (line 128) contains:
   ```javascript
   if (args[i].startsWith('-')) break;
   ```
   This breaks the parser for any fact containing negative values, hyphens, or dashes.
5. **Issue 5 (Command Injection & Orphans)**: `lib/memory/memfork.ts` (lines 26-29) contains:
   ```typescript
   const child = spawn(executable, spawnArgs, {
     env: { ...process.env },
     shell: process.platform === 'win32'
   });
   ```
   This executes the command in a Windows shell, presenting command injection risks when branch names have special characters (e.g. `&`), and leaving orphaned Node processes when `child.kill()` only terminates `cmd.exe`.
6. **Issue 6 (Fact Loss on Merge Conflicts)**: `lib/memory/merge.ts` (lines 239-245) contains:
   ```typescript
   let mergeFacts: string[] = [];
   if (conflicts.length > 0) {
     mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
   }
   ```
   This discards `diffFacts(factsTarget, factsSource).uniqueB` when resolving conflicts, causing all non-conflicting unique source facts to be lost.
7. **Issue 7 (Schema Validation)**: `lib/db/db.ts` (lines 31-35) lacks assertions for `db.mergeProposals`.

---

## 2. Logic Chain

1. **Lost Update Concurrency**: Serializing reads and writes separately allows overlapping transaction execution. Wrapping them in a single, sequential task in the queue resolves this.
2. **Process write collisions**: Directory creation is an atomic OS system call across platforms. Implementing directory locks (`db.json.lock`) prevents multiple processes from concurrent filesystem access. Using unique UUID temp files avoids Windows filesystem conflicts.
3. **Branch Isolation**: The commit DAG uniquely represents a branch's state. Resolving history by walking backwards from the branch head using `parentCommit` pointers excludes commits added to parent branches post-fork. Linking the first commit of a child branch to the parent branch's head commit connects the DAG.
4. **CLI Argument parsing**: Hyphenated strings are valid CLI arguments. Iterating through arguments sequentially and checking only for known flags prevents premature termination of fact parsing.
5. **Windows Shell Metacharacters**: Running with `shell: false` completely bypasses shell parsing, preventing command injection. On Windows, this routes the kill signal directly to the Node process rather than to a wrapper `cmd.exe` process, preventing orphans.
6. **Fact Loss on Merge**: Resolving a conflict only settles the conflicting items. Non-conflicting unique source branch facts do not contradict the target branch and must be merged in addition to the resolved facts.
7. **Schema Verification**: Failing to assert that `mergeProposals` is a valid array triggers runtime TypeErrors when accessing it. Asserting array shape in `validateSchema` guarantees type safety.

---

## 3. Caveats

- **No Caveats**. All 7 issues have been fully traced to specific code segments and solved conceptually.

---

## 4. Conclusion

The implementation has critical bugs across memory concurrency, cross-process write lockouts, branch isolation, argument parsing, input sanitization, process termination, and merge logic.
We have designed a detailed and actionable strategy to fix these 7 issues, providing concrete code structures and mechanisms (atomic transaction queue, directory-based lockfile, DAG-based recall traversal, sequential parser, shell-less spawn, lossless merge resolver, and type schema completion).

---

## 5. Verification Method

To verify the fixes once implemented:
1. **Concurrency test**: Run the E2E tier 2 stress tests:
   ```powershell
   npm run test:tier2
   ```
   Assert that the database contains the correct number of branches (e.g. 101 for Case 2.6.2) and no write/lockout crashes occur.
2. **CLI Argument parsing**: Run arguments validation tests or execute:
   ```powershell
   node scripts/run-e2e.js
   ```
   And verify all E2E test suites pass successfully.
3. **Schema completeness**: Manually remove `mergeProposals` from a test JSON database and assert `validateSchema` correctly detects it as invalid.
