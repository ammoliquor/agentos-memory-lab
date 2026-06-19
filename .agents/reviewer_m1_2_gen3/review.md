# Quality & Adversarial Review Report — Milestone 1 Gen 3

## Review Summary

**Verdict**: REQUEST_CHANGES

This review evaluates the Milestone 1 Gen 3 codebase for correctness, TypeScript type-safety, and robustness. While the core CLI wrappers and database schema validation are well-structured and type-safe, there are critical architectural concurrency flaws in the database API, semantic leaks in the merge resolution lineage, and edge-case vulnerabilities in command argument parsing.

---

## Findings

### [Critical] Concurrency and Isolation Violation (Lost Updates) in the Database Layer

- **What**: Multiple concurrent updates using `readDb()` and `writeDb()` result in lost updates (race conditions).
- **Where**: `lib/db/db.ts` (`readDb`, `writeDb`), `tests/e2e/tier1_feature.test.js` (Test Case 4.4), and `tests/e2e/tier2_boundary.test.js` (Test Case 2.6.2).
- **Why**: `readDb()` and `writeDb()` release and acquire the file lock separately. Under parallel execution (such as `Promise.all` in E2E tests), all reads execute first, reading the same stale state. When they subsequently call `writeDb()`, they overwrite each other. E2E tests asserting that parallel `readDb`/`writeDb` calls successfully merge state are mathematically guaranteed to fail if executed concurrently in isolation.
- **Suggestion**: 
  1. Rewrite E2E tests 4.4 and 2.6.2 to use the atomic `updateDb()` function or CLI `branch()` commands (which wrap the entire read-modify-write lifecycle in a single locked transaction).
  2. Document `readDb` and `writeDb` as unsafe for concurrent update workflows.

### [Major] Semantic Merge Fact Loss & Contradiction Leakage

- **What**: Resolved conflicts are not suppressed from history, leading to contradiction leakage in recalled facts.
- **Where**: `lib/memory/merge.ts` (`mergeBranches` and `recallFacts`).
- **Why**: When merging branches with conflicts, the user provides a resolution fact, and the merge commit is created pointing to both parent heads. Because `recallFacts` recursively traverses the entire DAG ancestry via parent links, both the original contradictory facts (e.g., `"Use PostgreSQL"` and `"Do not use PostgreSQL"`) and the resolved fact are returned. This violates the semantic contract of conflict resolution, as the history retains and leaks the contradiction to the caller.
- **Suggestion**: Introduce a tombstone/negation list in the merge commit metadata to override/ignore conflicting ancestor facts during `recallFacts` traversal.

### [Minor] CLI Argument Parsing Collision

- **What**: A fact containing `-m` or `--sleep` breaks facts parsing and corrupts command arguments.
- **Where**: `scripts/mock-memfork.js` (lines 324-325).
- **Why**: The custom parsing loop terminates facts collection when it encounters `-m` or `--sleep`. If a user attempts to record a fact that mentions these flags, the parser breaks, treating subsequent inputs incorrectly.
- **Suggestion**: Use a formal CLI parser (like `minimist` or `commander`) or enforce character/comma separation for fact lists.

### [Minor] CPU Blocking Busy-Loop in Mock CLI

- **What**: Lock acquisition backoff blocks the CPU thread.
- **Where**: `scripts/mock-memfork.js` (lines 75-76).
- **Why**: Backoff delay uses a busy loop `while (Date.now() < sleepUntil) {}` which runs at 100% CPU usage for that process thread during backoff.
- **Suggestion**: Use a non-blocking delay if possible, or trigger a synchronous sleep using system tools (e.g. `execSync` with a small timeout).

---

## Verified Claims

- **Branch Name Validation** → verified via `lib/memory/memfork.ts` (lines 8-15) → **PASS** (Strict alphanumeric check `/^[a-zA-Z0-9-_]+$/` prevents command injection via branch names).
- **Shell-Less CLI Execution** → verified via `lib/memory/memfork.ts` (line 37) → **PASS** (Child process spawned with `shell: false` ensuring argument safety).
- **TypeScript Type Safety** → verified via `lib/types/index.ts` → **PASS** (Interface definitions cover all required schemas: Branch, Commit, Message, Conflict, MergeProposal, DatabaseSchema).

---

## Coverage Gaps

- **Database Lock Session Isolation** — risk level: **HIGH** — The database lacks a multi-operation session lock. If a workflow needs to read, make business logic checks, and then write, it has to fit entirely inside `updateDb`'s callback, or it will risk lost updates. Recommend adding session/connection lock support if transactions span multiple files/modules.
- **Semantic Overrides** — risk level: **MEDIUM** — Fact recall only accumulates and has no mechanism to delete or invalidate facts.

---

## Unverified Items

- **Empirical test execution** — The E2E tests and type-checks were verified through deep static analysis of files and scripts. The command `node scripts/verify-project.js` was proposed but could not be run empirically due to automated permission prompt timeouts on the execution harness.
