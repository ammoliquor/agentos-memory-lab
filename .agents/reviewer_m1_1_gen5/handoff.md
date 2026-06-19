# Handoff Report: Milestone 1 Gen 5 Review

## 1. Observation

- **Observation 1 (Conflict resolution filtering)**: In `lib/memory/merge.ts` (lines 316–320), resolved facts are filtered based on whether they are already in the target branch:
  ```typescript
  const mergedSet = new Set([
    ...resolvedFacts.filter(f => !factsTarget.includes(f)),
    ...nonConflictingSourceFacts
  ]);
  ```
- **Observation 2 (Retraction of all conflicting facts)**: In `lib/memory/merge.ts` (lines 337–345), all conflicting facts (both `factA` and `factB`) are added to the retractions array:
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
- **Observation 3 (Recall logic applying retractions)**: In `lib/memory/merge.ts` (lines 254–264), `recallFacts` applies retractions to delete facts from the active set before asserting new facts:
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
- **Observation 4 (Mock CLI ignoring retractions)**: In `scripts/mock-memfork.js` (lines 223–237), `recallFacts` does not check or apply `commit.retractions`:
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
- **Observation 5 (E2E Test case structure)**: In `tests/e2e/tier2_boundary.test.js` (lines 234–249), `Test Case 2.6.5` merges a conflicting branch into `main` with a target-favoring resolved fact (`'Use PostgreSQL'`) and asserts that it remains active by using `recall('main')` (which executes the mock CLI).

---

## 2. Logic Chain

1. From **Observation 1**, if a resolved fact is already in `factsTarget`, it is filtered out of `mergeFacts` in the merge commit.
2. From **Observation 2**, since the resolved fact was in conflict, it is added to `retractions` in the merge commit.
3. From **Observation 3**, when calling `recallFacts` inside `lib/memory/merge.ts`, the resolved fact will be deleted from the active facts list via `retractions` and will not be re-added via `facts`, causing it to be permanently tombstoned.
4. From **Observation 4**, the mock CLI's `recallFacts` does not handle retractions, so it returns all historical facts of ancestors.
5. From **Observation 5**, when the test runs, it calls `recall('main')` which runs the mock CLI. The mock CLI returns `'Use PostgreSQL'` (and incorrectly `'Do not use PostgreSQL'`), causing the test's assertion to pass even though the underlying state is corrupted and the library's `recallFacts` would not return it.
6. Therefore, the actual conflict resolution tombstoning logic has a correctness bug (asymmetric deletion of target-favoring resolved facts) and the test suite passes only because of an incomplete/facade mock CLI implementation.

---

## 3. Caveats

- **Verification Environment**: The automated E2E test execution and typecheck via `node scripts/verify-project.js` timed out due to the host system permission prompt timing out. Static analysis and manual logic tracing were used instead to confirm the correctness errors.

---

## 4. Conclusion

The Milestone 1 Gen 5 fixes require changes (**REQUEST_CHANGES**):
1. **Critical Bug**: `lib/memory/merge.ts` incorrectly filters out resolved facts that are already in `factsTarget`, leading to their silent deletion/tombstoning after merging.
2. **Major Gaps / Facade**: The mock CLI in `scripts/mock-memfork.js` does not implement retraction/tombstoning support, masking the correctness bug.

---

## 5. Verification Method

To independently verify these findings:
1. Examine `lib/memory/merge.ts` line 317 and compare with line 344 to verify the filtering and retraction logic.
2. Examine `scripts/mock-memfork.js` line 223 to confirm the lack of retraction processing.
3. To trigger the failure in the test suite:
   - Update `recallFacts` in `scripts/mock-memfork.js` to process retractions (similar to `lib/memory/merge.ts` lines 254-264).
   - Run the E2E tests using `node scripts/verify-project.js`. The test suite will fail on `Test Case 2.6.5` and other combined/scenario tests because resolved facts are tombstoned.
