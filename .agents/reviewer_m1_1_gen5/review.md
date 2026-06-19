# Review Report: Milestone 1 Gen 5 Fixes

## Quality Review Summary

**Verdict**: **REQUEST_CHANGES**

---

## Findings

### [Critical] Finding 1: Correctness Bug — Tombstoning of Resolved Target Facts
- **What**: When resolving a merge conflict, if a resolved fact is already present in the target branch's history, it is completely deleted (tombstoned) after the merge instead of remaining active.
- **Where**: `lib/memory/merge.ts` (lines 311–323, 337–345, 244–267)
- **Why**: 
  1. In `mergeBranches`, `mergeFacts` is computed as:
     ```typescript
     const mergedSet = new Set([
       ...resolvedFacts.filter(f => !factsTarget.includes(f)),
       ...nonConflictingSourceFacts
     ]);
     mergeFacts = Array.from(mergedSet);
     ```
     This filters out any fact in `resolvedFacts` that is already in `factsTarget` (e.g., `'Use PostgreSQL'`).
  2. Because the fact was in conflict, it is added to the `retractions` array (all conflicting facts from both sides are retracted).
  3. Consequently, the merge commit contains the fact in `retractions` but *not* in `facts`.
  4. During `recallFacts`, the fact is deleted from the active set via `retractions` and is never re-added (since it's missing from `facts`).
- **Suggestion**: Do not filter out resolved facts that are already in `factsTarget` if they are also in the `retractions` array (or simply include all `resolvedFacts` directly in `mergeFacts` regardless of whether they exist in `factsTarget`, as their retraction will delete them first, and they must be re-added to remain active).

### [Major] Finding 2: Integrity Violation — Facade/Dummy CLI Implementation Masking Code Bugs
- **What**: The mock CLI implementation of fact recall completely ignores retractions/tombstoning, returning all facts ever asserted in any ancestor commit.
- **Where**: `scripts/mock-memfork.js` (lines 223–237)
- **Why**: 
  - `recallFacts` in the mock CLI simply accumulates all facts from all ancestor commits without checking `commit.retractions`.
  - In `tests/e2e/tier2_boundary.test.js` (Test Case 2.6.5), the test asserts that `'Use PostgreSQL'` is recalled after a conflict resolution. The test passes *only* because the mock CLI does not implement retractions at all. If it did, the test would fail due to **Finding 1**.
  - Additionally, this means the mock CLI incorrectly returns both conflicting facts (e.g., `'Use PostgreSQL'` and `'Do not use PostgreSQL'`), which is semantically incorrect and violates the concept of conflict resolution.
- **Suggestion**: Implement `retractions` handling in `scripts/mock-memfork.js`'s `recallFacts` to match the behavior of `lib/memory/merge.ts`'s `recallFacts`.

### [Minor] Finding 3: TypeScript Type-Safety — validateSchema Parameter and Type Guard
- **What**: `validateSchema` is typed as accepting `DatabaseSchema` but performs basic type assertions that would compile-time fail or be redundant if the argument was strictly of that type.
- **Where**: `lib/db/db.ts` (lines 32–75)
- **Why**: Since `validateSchema` validates untrusted JSON read from disk, the input is effectively `any` or `unknown`.
- **Suggestion**: Change the signature to a TypeScript type guard:
  ```typescript
  export function validateSchema(db: any): db is DatabaseSchema
  ```

---

## Verified Claims

- **Branch creation validation** → Verified via `lib/memory/memfork.ts` lines 8-16 and 78-87 → **PASS**
- **Commit parameter validation** → Verified via `lib/memory/memfork.ts` lines 89-109 → **PASS**

---

## Coverage Gaps

- **Test coverage for retractions on mock CLI**: The E2E tests check for conflict resolution but use the mock CLI, which doesn't actually support retractions. There is zero E2E test coverage verifying that retractions/tombstones are correctly handled by the CLI layer. (Risk level: **High**)

---

## Unverified Items

- **E2E Test Suite Execution**: Run aborted due to terminal permission timeout on the host system. The code logic verification was completed via static trace analysis.

---
---

## Challenge/Adversarial Review Summary

**Overall risk assessment**: **HIGH**

---

## Challenges

### [High] Challenge 1: Asymmetric Conflict Resolution
- **Assumption challenged**: Resolving a conflict in favor of the target branch's fact vs. the source branch's fact has symmetric outcomes.
- **Attack scenario**: 
  - If we resolve in favor of the target branch's fact `factA` (which is already in `factsTarget`), it gets retracted and not re-asserted, deleting it.
  - If we resolve in favor of the source branch's fact `factB` (which is not in `factsTarget`), it gets retracted and re-asserted, keeping it active.
- **Blast radius**: Silent deletion of resolved target-favoring facts (state corruption).
- **Mitigation**: Ensure that any resolved fact is explicitly re-asserted in `facts` if it is retracted, regardless of whether it is in the target history.

### [Medium] Challenge 2: Direct Command Injection Prevention
- **Assumption challenged**: The shell wrapper is safe from injection.
- **Attack scenario**: The child process execution uses `shell: false` to prevent command injection. However, if `memfork` is invoked on Windows and `MEMFORK_CLI_PATH` is not set, it spawns `memfork` directly.
- **Blast radius**: Low/Medium. Since inputs are validated using `validateBranchName`:
  ```typescript
  if (!/^[a-zA-Z0-9-_/]+$/.test(trimmed)) { ... }
  ```
  This regex prevents common injection characters, which is a robust defense.

---

## Stress Test Results

- **Conflict resolution with target-favoring fact**:
  - *Expected behavior*: The target-favoring fact remains active after merge.
  - *Actual behavior*: The target-favoring fact is tombstoned and disappears from the recalled facts.
  - *Result*: **FAIL**

---

## Unchallenged Areas

- **Concurrency/Locking performance under extreme load**: We did not perform benchmarking on database lock contention, which could lead to bottlenecks under high parallel agent activity.
