## 2026-06-19T05:48:11Z

You are the Worker for Milestone 1 Gen 6.
Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\worker_m1_gen6.
Your task is to implement the following fixes in the Milestone 1 codebase:

1. **Owner-Token Based Locking (lib/db/db.ts & scripts/mock-memfork.js)**:
   Implement owner token verification to prevent stale lock theft.
   - When acquiring a lock (acquireLockAsync / acquireLockSync), accept a unique ownerToken: string (e.g., generated via crypto.randomUUID()). After successfully creating the lock directory (mkdir), write the ownerToken to a file inside the lock directory: ${lockPath}/owner.
   - When releasing a lock (releaseLockAsync / releaseLockSync), accept the ownerToken. Read the ${lockPath}/owner file. Only delete the owner file and lock directory if the current owner token matches the passed token.
   - Update readDb, writeDb, updateDb, and runTransactional to generate a random UUID ownerToken at the start of each transaction and pass it to lock acquisition and release.

2. **Tombstoning of Resolved Target Facts (lib/memory/merge.ts)**:
   In mergeBranches, do not filter out resolved facts that exist in factsTarget. Simply populate mergeFacts as the union of resolvedFacts and nonConflictingSourceFacts directly:
   ```typescript
      const mergedSet = new Set([
        ...resolvedFacts,
        ...nonConflictingSourceFacts
      ]);
      mergeFacts = Array.from(mergedSet);
   ```

3. **Mock CLI Recall Retractions (scripts/mock-memfork.js)**:
   Update recallFacts in scripts/mock-memfork.js to support retractions by matching the logic in lib/memory/merge.ts. Sort ancestor commits by timestamp (oldest first), maintain active facts set, process retractions (deleting from active set), and process facts (adding to active set).

4. **Schema validation Type Guard (lib/db/db.ts)**:
   Change the TypeScript signature of validateSchema in lib/db/db.ts to:
   ```typescript
   export function validateSchema(db: any): db is DatabaseSchema
   ```

After making the changes, execute `node scripts/verify-project.js` to ensure the TypeScript check and E2E test suite pass cleanly.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
