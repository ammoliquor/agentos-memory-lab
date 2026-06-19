## 2026-06-19T02:31:46Z
You are the Worker for Milestone 1 Gen 3.
Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\worker_m1_gen3.
Your task is to implement the following fixes in the Milestone 1 codebase:

1. **Lost Update in mergeBranches (lib/memory/merge.ts)**:
   Wrap the entire read-modify-write block in mergeBranches inside a call to updateDb (or keep the lock active) so that fact diffing, conflict detection, and merge commit creation are executed atomically. Use a local variable inside the function to capture and return the created Commit.

2. **Lock-Breaking Vulnerability (lib/db/db.ts & scripts/mock-memfork.js)**:
   Implement atomic stale lock cleanup. When a stale lock is detected (> 10s), instead of directly deleting the directory, generate a unique temp folder path (e.g. dbPath + '.lock.stale.' + crypto.randomUUID()) and attempt to rename the lock directory to that temp path using fs.rename (or fs.renameSync in mock-memfork.js).
   If the rename succeeds, then this process owns the stale lock and can safely delete the stale temp folder recursively. If it fails, another process won the race; do nothing.

3. **CLI Argument Parser (scripts/mock-memfork.js)**:
   Refactor facts argument parsing. Identify the exact indices of -m (and the next index for message) and --sleep. When collecting facts following --facts, loop through process.argv indices from factsIndex + 1 to the end, and only push arguments to facts if their index is NOT the -m flag, the message, or the --sleep flag. Do not break or exit the loop when encountering values like "-m" or "--sleep".

4. **Retract/Tombstone Facts after Merge (lib/types/index.ts, lib/db/db.ts, scripts/mock-memfork.js, lib/memory/merge.ts)**:
   - Extend the Commit interface to include an optional retractions?: string[] field.
   - Update validateSchema in both db.ts and mock-memfork.js to validate retractions as an optional array of strings.
   - In mergeBranches (lib/memory/merge.ts), if conflicts were resolved, collect all conflicting facts (both factA and factB) and save them as retractions in the mergeCommit.
   - Update recallFacts (lib/memory/merge.ts) to build a set of retracted facts by traversing ancestors, and filter out any fact whose normalized value is in the retracted set.

5. **Incorrect Lineage Fallback (lib/memory/merge.ts)**:
   In getAncestorCommits, when traversing parent commits, if commit.parentCommit is null, resolve the parent branch's start point by using branchObj.forkCommitId instead of the parent branch's current head commit. (i.e. branchObj.forkCommitId || getBranchHeadCommitId(branchObj.parentBranchId, db)).

6. **Verification**:
   Execute node scripts/verify-project.js to verify that all E2E tests pass.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
