# Challenge Report — Milestone 1 Adversarial Review

## Challenge Summary

**Overall risk assessment**: CRITICAL

The Milestone 1 core database and CLI wrapper implementation contains critical design flaws and bugs that undermine state persistence correctness, merge resolution safety, branch isolation, and CLI execution robustness. Under concurrent stress testing (100+ concurrent writes), the system suffers from silent data loss and database file corruption. Additionally, resolving conflicts currently deletes all other non-conflicting changes in the merge.

---

## Challenges

### [Critical] Challenge 1: Concurrent DB Write Race Conditions & Data Loss

- **Assumption challenged**: The database serialization queue in `lib/db/db.ts` and the CLI wrapper in `mock-memfork.js` safely handle concurrent database writes.
- **Attack scenario**: 
  - **Process-level concurrency**: When the application executes multiple `memfork` commands concurrently (e.g., in a parallel agent pipeline or under 100+ concurrent API requests), the wrapper spawns separate Node.js processes running `scripts/mock-memfork.js`. These independent OS processes execute synchronous file reads and writes (`fs.readFileSync`, `fs.writeFileSync`, `fs.renameSync`) without any cross-process locking (e.g., using `proper-lockfile`). They all read the database file at the same time, apply their local updates, and overwrite the database. The last write wins, silently discarding all other concurrent writes.
  - **Memory-level concurrency**: In `lib/db/db.ts`, functions like `addBranch`, `addCommit`, and `addMessage` are not atomic. They `await readDb()`, push to the retrieved arrays *outside* the queue, and then `await writeDb()`. Under concurrency, multiple calls will read the same stale database state, append their elements, and overwrite each other, losing data.
- **Blast radius**: Complete data loss and state corruption under concurrent writes.
- **Mitigation**: 
  - Add process-level file locking in `mock-memfork.js` and `memfork` during database updates.
  - In `lib/db/db.ts`, modify the serialization queue so that the entire read-modify-write transactional sequence is enqueued together, rather than enqueuing reads and writes as separate, non-atomic actions.

### [Critical] Challenge 2: Catastrophic Fact Loss on Conflict Resolution

- **Assumption challenged**: Merging a branch with a resolved conflict preserves all non-conflicting unique facts from the source branch.
- **Attack scenario**: In `mergeBranches` (`lib/memory/merge.ts`), when conflicts are detected (`conflicts.length > 0`) and `resolvedFacts` are supplied, the facts to be committed are calculated strictly as:
  ```typescript
  mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
  ```
  The logic completely skips the `else` block where `diffFacts` is used to capture the non-conflicting unique facts of the source branch. As a result, all non-conflicting changes on the source branch are completely discarded.
- **Blast radius**: Discarding all unique, non-conflicting facts from the source branch when resolving a conflict.
- **Mitigation**: Combine the resolved facts with the unique, non-conflicting facts from the source branch:
  ```typescript
  const diff = diffFacts(factsTarget, factsSource);
  mergeFacts = [
    ...resolvedFacts.filter(f => !factsTarget.includes(f)),
    ...diff.uniqueB.filter(f => !resolvedFacts.includes(f)) // Include unique non-conflicting facts
  ];
  ```

### [High] Challenge 3: Infinite Conflict Loop with Hybrid/Co-existence Resolved Facts

- **Assumption challenged**: Resolving a conflict allows subsequent operations to progress normally.
- **Attack scenario**: A user resolves a conflict between SaaS and On-Premise models by creating a hybrid statement (e.g., *"SaaS model for SME banking, maintaining optional On-premise air-gapped installations for Tier 1 Enterprise banks"*). In a subsequent merge, another developer tries to merge a new SaaS-related fact. Because the resolved fact in the target branch contains the `on-premise` keyword and the new fact contains the `saas` keyword, the `detectConflicts` deployment check flags a conflict again:
  ```typescript
  if ((isSaaS_A && isOnPrem_B) || (isSaaS_B && isOnPrem_A))
  ```
  Because the target branch now has a fact that is both SaaS and On-Premise, it will conflict with *any* subsequent SaaS or On-Premise deployment fact.
- **Blast radius**: The target branch is locked into an infinite loop of manual conflict resolutions for all future deployment-related additions.
- **Mitigation**: Skip checking conflicts against facts that have already been marked as resolved in the merge history, or refine the semantic model to recognize compatible hybrid statements.

### [High] Challenge 4: Commit DAG Lineage Leakage in Fact Recall

- **Assumption challenged**: Creating a child branch isolates it from future changes in the parent branch until an explicit merge occurs.
- **Attack scenario**: Both `recall` in `mock-memfork.js` and `recallFacts` in `merge.ts` resolve facts by traversing the branch path (`parentBranchId` chain) and gathering all commits on those branch IDs. They do not trace the commit DAG (`parentCommit` chain) or the branching time. If a child branch is created from `main`, and then new commits are made to `main`, recalling the child branch will pull in those new parent commits, leaking future parent state.
- **Blast radius**: Violation of basic branch isolation.
- **Mitigation**: Walk the commit DAG starting from the active branch's head commit via the `parentCommit` property, rather than blindly fetching all commits by branch ID.

### [Medium] Challenge 5: Spurious Semantic Conflict False Positives

- **Assumption challenged**: The semantic matching rules in `detectConflicts` accurately identify actual contradictions.
- **Attack scenario**:
  - **Mutual Exclusion Check**: Flags a conflict between two sentences if they contain different keywords from the same category and both contain choice verbs (e.g. "use", "deploy"). This flags complementary statements, such as "Use PostgreSQL for transactional processing" and "Deploy ClickHouse for analytics", as mutually exclusive choices.
  - **Substring Negation Matching**: The negation word `"no"` is matched without word boundaries (using `.includes("no")`). As a result, unrelated words like `"node"`, `"normal"`, etc., are treated as containing negation, causing false positive contradictions (e.g. `"Node backend"` contradicting `"de backend"`).
  - **Tradeoff vs Recommendation**: Any sentence containing warning/tradeoff words (e.g. `"overhead"`) will conflict with an assertive statement about the same technology (e.g. "Use WebSockets" vs "WebSockets have connection state overhead"). These are complementary, not contradictory.
- **Blast radius**: Spurious manual resolution requirements for compatible/tradeoff statements.
- **Mitigation**:
  - Implement proper word boundary checks for negations (e.g. `\bno\b`).
  - Refine category checks to allow combinations of technologies when they serve different roles (e.g. transactional vs analytical), rather than treating all category keywords as mutually exclusive.

### [Medium] Challenge 6: CLI Argument Parser Breakage on Hyphenated Facts

- **Assumption challenged**: The CLI parser correctly handles all fact strings passed via `--facts`.
- **Attack scenario**: In `mock-memfork.js`, facts are parsed from CLI arguments by iterating over arguments after `--facts`. If an argument starts with `-` (e.g. `"- Fact 1"`), the parser assumes it is another flag and breaks out of the loop: `if (args[i].startsWith('-')) break;`. Any hyphenated markdown-style facts (which are extremely common in multi-agent generated lists) will stop the fact parser entirely, leading to empty or partially parsed facts.
- **Blast radius**: Inability to pass facts containing negative numbers, markdown hyphens, or dashed parameters to the CLI.
- **Mitigation**: Skip parsing only if the argument matches a known CLI flag (like `-m` or `--from`), rather than any argument starting with `-`.

### [Low] Challenge 7: Windows Shell Metacharacter Vulnerability and Process Orphaning

- **Assumption challenged**: Spawned processes are executed and terminated safely on all environments.
- **Attack scenario**: A branch name containing shell metacharacters (e.g. `feat&calc`) is spawned on Windows with `shell: true`. This causes `cmd.exe` to interpret `&` and execute the injected command (`calc`). Furthermore, on timeouts, calling `child.kill()` on Windows kills the `cmd.exe` shell but leaves the underlying `mock-memfork.js` Node process running.
- **Blast radius**: Command injection vulnerabilities and orphaned background processes holding file locks.
- **Mitigation**: Sanitize branch names against shell metacharacters before spawning. Use a cross-platform process tree killer (like `tree-kill`) on timeouts instead of `child.kill()`. Avoid using `shell: true` unless strictly necessary.

---

## Stress Test Results

- **Concurrency write stress test** → Initiate 100+ concurrent writes to `mock-memfork.js` / `lib/db/db.ts` → Overwrites occur, resulting in data loss (only 1 or 2 writes saved) → **FAIL**
- **Hyphenated facts parsing** → Pass `"- Fact 1"` to CLI `commit` → Parser breaks early, committing no facts → **FAIL**
- **Complementary technology choice** → Diff/merge `Use Postgres...` and `Deploy ClickHouse...` → Mutual exclusion check flags false-positive conflict → **FAIL**
- **Hybrid resolved fact subsequent merge** → Merge `SaaS model... and On-premise...` resolved fact, then merge new SaaS fact → Deployment contradiction check triggers false-positive conflict → **FAIL**
- **Weird branch character shell injection** → Pass `weird&calc` as branch name on Windows → Shell interprets `&` and executes command → **FAIL**
- **Child process termination on Windows** → Trigger timeout on mock execution → parent `cmd.exe` is killed, but node child is orphaned → **FAIL**

---

## Unchallenged Areas

- **Frontend visualizers** — React Flow visualizer implementation is planned for Milestone 4 and was not reviewed or tested.
- **Merge Proposal UI Modals** — UI integration was out of scope for the Milestone 1 core database/CLI review.
