# Handoff Report

## 1. Observation
- In `lib/memory/merge.ts` (lines 311-321):
  ```typescript
      let mergeFacts: string[] = [];
      if (conflicts.length > 0) {
        const conflictingSourceFacts = new Set(conflicts.map(c => c.factB));
        const nonConflictingSourceFacts = diff.uniqueB.filter(f => !conflictingSourceFacts.has(f));

        const mergedSet = new Set([
          ...resolvedFacts.filter(f => !factsTarget.includes(f)),
          ...nonConflictingSourceFacts
        ]);
        mergeFacts = Array.from(mergedSet);
      }
  ```
- In `lib/memory/merge.ts` (lines 337-345):
  ```typescript
      let retractions: string[] | undefined;
      if (conflicts.length > 0) {
        const allConflicting = new Set<string>();
        for (const c of conflicts) {
          allConflicting.add(c.factA);
          allConflicting.add(c.factB);
        }
        retractions = Array.from(allConflicting);
      }
  ```
- In `lib/memory/merge.ts` (lines 253-264):
  ```typescript
    for (const commit of ancestors) {
      if (commit.retractions) {
        for (const r of commit.retractions) {
          activeNormalized.delete(normalizeFact(r));
        }
      }
      for (const fact of commit.facts) {
        const normFact = normalizeFact(fact);
        activeNormalized.add(normFact);
        originalCaseMap.set(normFact, fact);
      }
    }
  ```
- In `scripts/mock-memfork.js` (lines 223-237):
  ```javascript
  function recallFacts(db, branchId) {
    const headCommitId = getBranchHeadCommitId(db, branchId);
    if (!headCommitId) return [];

    const ancestors = getAncestorCommits(db, headCommitId);
    const allFacts = [];
    for (const commit of ancestors) {
      for (const fact of commit.facts) {
        if (!allFacts.includes(fact)) {
          allFacts.push(fact);
        }
      }
    }
    return allFacts;
  }
  ```
- In `tests/e2e/tier2_boundary.test.js` (lines 234-249):
  ```javascript
      test('Test Case 2.6.5: Conflict resolution fact tombstoning edge case', async () => {
        await branch('branch-a', 'main');
        await branch('branch-b', 'main');

        await commit('branch-a', 'Commit A', ['Use PostgreSQL']);
        await commit('branch-b', 'Commit B', ['Do not use PostgreSQL']);

        await mergeBranches('branch-a', 'main');

        const resolvedFacts = ['Use PostgreSQL'];
        await mergeBranches('branch-b', 'main', resolvedFacts);

        const recalledMain = await recall('main');
        assert.ok(recalledMain.includes('Use PostgreSQL'), 'Resolved fact should not be tombstoned');
      });
  ```
- The project verification command `node scripts/verify-project.js` timed out due to non-interactive environment permissions.

## 2. Logic Chain
- When a conflict is merged and resolved to a fact already present in the target branch (e.g. `Use PostgreSQL`), `factsTarget.includes('Use PostgreSQL')` is `true`.
- Due to the filtering logic in `mergeBranches` (line 316), this resolved fact is excluded from `mergeFacts`, so it is not asserted in the merge commit's `facts`.
- However, since it is a conflicting fact, it is still included in the merge commit's `retractions` list.
- When the library's `recallFacts` processes this merge commit, it deletes the fact from `activeNormalized` (due to `retractions`) but never adds it back (as it is missing from `facts`). This permanently tombstones the resolved fact in the core library implementation.
- In `Test Case 2.6.5`, `recall('main')` runs the mock CLI (`scripts/mock-memfork.js`).
- The mock CLI's `recallFacts` implementation completely ignores `commit.retractions` and returns all facts in the ancestry list.
- Therefore, the mock CLI returns `Use PostgreSQL`, causing the test to pass.
- This creates a false-positive E2E test verification where a critical bug in the core library is bypassed due to a dummy mock CLI implementation.

## 3. Caveats
- Statically verified only. Verification command `node scripts/verify-project.js` timed out.
- Assumes `mock-memfork.js` is the target CLI executing during tests, as configured in the test harness environment.

## 4. Conclusion
- The implementation has a Critical Correctness Bug (resolved facts tombstoned on target branch resolution) and a Critical Integrity Violation (verification bypass via dummy mock CLI).
- Verdict: REQUEST_CHANGES.

## 5. Verification Method
- Inspect `lib/memory/merge.ts` at line 316. Observe that `resolvedFacts` are filtered to exclude `factsTarget` elements.
- Inspect `scripts/mock-memfork.js` at lines 223-237. Observe that `recallFacts` has no retraction filtering.
- Independently verify by writing a library-level test that calls `recallFacts` from `lib/memory/merge.ts` directly on the database after resolving a conflict. Verify it returns an empty list `[]` instead of the resolved fact.
