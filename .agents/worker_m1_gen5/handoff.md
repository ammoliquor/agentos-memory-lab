# Handoff Report

## 1. Observation
- In `lib/memory/merge.ts`, the original implementation of `recallFacts` built a global `retractedSet` first and then filtered out any facts whose normalized form was in that set, regardless of when the retraction or the assertion happened:
  ```typescript
  const retractedSet = new Set<string>();
  for (const commit of ancestors) {
    if (commit.retractions) {
      for (const r of commit.retractions) {
        retractedSet.add(normalizeFact(r));
      }
    }
  }
  ```
- This caused a bug: if a fact was retracted in a merge commit but resolved and re-asserted in that same merge commit, the resolved fact would be filtered out since its normalized form was added to the global `retractedSet`.
- In `tests/e2e/tier2_boundary.test.js`, there was no existing test verifying conflict resolution fact tombstoning recovery.

## 2. Logic Chain
- Running chronological ordering ensures that deletions from retractions are processed before assertions of facts for any commit, including merge commits:
  1. Sort all ancestor commits from oldest to newest by timestamp: `ancestors.sort((a, b) => a.timestamp - b.timestamp)`.
  2. Maintain a set of currently active normalized facts (`activeNormalized`) and a map of normalized facts to their original-cased strings (`originalCaseMap`).
  3. Loop through each sorted commit. For each commit:
     - First, process its `retractions` list: delete each normalized retraction from `activeNormalized`.
     - Second, process its `facts` list: add each normalized fact to `activeNormalized`, and save the mapping in `originalCaseMap`.
  4. Consequently, if a merge commit retracts a fact (as a conflict) but asserts it as a resolved fact, the retraction (deletion) is processed first, and the assertion (addition) is processed second, correctly leaving it active.
  5. Finally, map the remaining active normalized facts back to their original-cased strings.

## 3. Caveats
- The verification command `node scripts/verify-project.js` could not be executed within this environment because the permission prompt timed out.
- The chronological sorting assumes that commit timestamps are accurate representations of commit history ordering. Since `getAncestorCommits` also performs timestamp sorting, this is a safe project-level assumption.

## 4. Conclusion
- The refactored `recallFacts` resolves the fact tombstoning edge case under conflict resolution.
- We added `Test Case 2.6.5: Conflict resolution fact tombstoning edge case` in `tests/e2e/tier2_boundary.test.js` to assert the correct behavior.

## 5. Verification Method
- Execute the project verification suite using:
  ```powershell
  node scripts/verify-project.js
  ```
- File verification: inspect the refactored `recallFacts` in `lib/memory/merge.ts` and the test case `Test Case 2.6.5` in `tests/e2e/tier2_boundary.test.js`.
- Invalidation condition: the verification script exits with non-zero or the newly added test case fails to pass.
