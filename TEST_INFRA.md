# E2E Test Infrastructure & Architecture Design

This document outlines the End-to-End (E2E) testing architecture and case catalog for **AgentOS Memory Lab**. This architecture ensures that the database operations, the `memfork` CLI wrapper, agent orchestration, and merge conflict resolution logic function seamlessly.

---

## 1. Testing Architecture Overview

The E2E testing framework is designed to verify the entire system stack, from lower-level child process wrappers and database persistence up to multi-agent parallel workflows and semantic merge operations.

```
                  ┌────────────────────────┐
                  │   E2E Test Runner      │
                  │ (scripts/run-e2e.js)   │
                  └───────────┬────────────┘
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  Tier 1 & 2  │ │    Tier 3    │ │    Tier 4    │
     │ Unit/Integr. │ │ Combinations │ │ Real-World   │
     └───────┬──────┘ └───────┬──────┘ └───────┬──────┘
             │                │                │
             └────────────────┼────────────────┘
                              │
                              ▼
               ┌─────────────────────────────┐
               │    Target Entry Points      │
               ├─────────────────────────────┤
               │ • lib/memory/memfork.ts     │
               │ • lib/db/db.ts              │
               │ • lib/memory/merge.ts       │
               │ • lib/agents/orchestrator.ts│
               └──────────────┬──────────────┘
                              │
                              ▼
             ┌─────────────────────────────────┐
             │     Isolated Test Resources     │
             ├─────────────────────────────────┤
             │ • .memfork/db.test.json         │
             │ • scripts/mock-memfork.js       │
             └─────────────────────────────────┘
```

### Components Under Test
1. **CLI Wrapper (`lib/memory/memfork.ts`)**: Invokes `memfork` executable using Node's `child_process`.
2. **Local DB Helper (`lib/db/db.ts`)**: Performs atomic reads and writes to `.memfork/db.json`.
3. **Multi-Agent Orchestrator (`lib/agents/orchestrator.ts`)**: Runs parallel forks and manages Research, Critic, and Builder agent execution.
4. **Merge & Diff Engine (`lib/memory/merge.ts`)**: Semantic difference classification and conflict detection.

---

## 2. Test Isolation & Environment Configuration

### Database Isolation
To ensure test runs do not affect development databases or leak state across test runs, the E2E suite enforces **database isolation**:
- The test runner sets `process.env.NODE_ENV = 'test'` and `process.env.MEMFORK_DB_PATH = '.memfork/db.test.json'`.
- The database module (`lib/db/db.ts`) reads `MEMFORK_DB_PATH` if present to load the test database file.
- **Before-All hook**: Creates a fresh `.memfork/db.test.json` containing empty arrays for branches, commits, and messages.
- **Before-Each hook**: Clears out commits and branch states, inserting only default seed branches (e.g. `main` branch).
- **After-All hook**: Deletes the `.memfork/db.test.json` file.

### CLI Mocking & Simulation Strategy
To enable E2E testing in environments where the compiled `memfork` CLI executable is not yet installed in the global `PATH`, the testing suite supports a Mock CLI runner:
- A node script `scripts/mock-memfork.js` is implemented to simulate CLI operations.
- During test initialization, the runner adds a temporary `bin` directory to the system `PATH` containing a shell wrapper (`memfork.cmd` on Windows, `memfork` on Unix) that executes `node scripts/mock-memfork.js`.
- The mock CLI maintains memory forks and commits directly in `.memfork/db.test.json`, preserving the exact exit codes and input/output contracts expected of the real CLI.

---

## 3. Test Case Catalog

### Tier 1: Feature Coverage
Verifies that individual functional blocks work as specified under nominal inputs.

#### 1. Branching (`lib/memory/memfork.ts`)
*   **Test Case 1.1: Create branch from main**
    *   *Input:* `name: "feature-a"`, `from: "main"`
    *   *Output:* Resolves successfully.
    *   *Verification:* Check `db.test.json` contains a branch with `id: "feature-a"` and `parentBranchId: "main"`.
*   **Test Case 1.2: Transitive branching (branch from child)**
    *   *Input:* `name: "feature-b"`, `from: "feature-a"`
    *   *Output:* Resolves successfully.
    *   *Verification:* Verify branch `"feature-b"` has `parentBranchId: "feature-a"`.
*   **Test Case 1.3: List branches**
    *   *Input:* No arguments.
    *   *Output:* Returns array of branch objects.
    *   *Verification:* Matches count of branches in database (e.g., `["main", "feature-a", "feature-b"]`).
*   **Test Case 1.4: Special character branch names**
    *   *Input:* `name: "feat/some-user_request-1"`
    *   *Output:* Resolves successfully.
    *   *Verification:* Verify the branch name matches exactly and does not crash shell execution.
*   **Test Case 1.5: Branch retrieval by name**
    *   *Input:* Retrieve details for branch `"feature-a"`.
    *   *Output:* Returns full metadata object.
    *   *Verification:* Object contains correct parent branch, active status, and timestamp.

#### 2. Committing (`lib/memory/memfork.ts`)
*   **Test Case 2.1: First commit to branch**
    *   *Input:* `branchId: "feature-a"`, `message: "Initial design"`, `facts: ["Add core DB"]`
    *   *Output:* Returns a `MemoryCommit` object.
    *   *Verification:* Verify returned commit has `parentCommit: null`, matching `branchId`, and `facts` list.
*   **Test Case 2.2: Sequential commits**
    *   *Input:* Commit to `"feature-a"` with `message: "Add CLI"`, `facts: ["Use child_process"]` after Case 2.1.
    *   *Output:* Returns new `MemoryCommit` object.
    *   *Verification:* Verify new commit's `parentCommit` points to the ID of the commit in Case 2.1.
*   **Test Case 2.3: Multi-fact commit**
    *   *Input:* `branchId: "feature-a"`, `message: "Bulk facts"`, `facts: ["Fact 1", "Fact 2", "Fact 3"]`
    *   *Output:* `MemoryCommit` containing all three facts.
    *   *Verification:* Facts are stored correctly without truncation.
*   **Test Case 2.4: Fast-forward sequence**
    *   *Input:* Multiple commits in rapid succession.
    *   *Output:* Creates a linked list in the DAG.
    *   *Verification:* Order of parent IDs matches execution order; timestamps increase monotonically.
*   **Test Case 2.5: Commit object validation**
    *   *Input:* Read commit from database.
    *   *Output:* `MemoryCommit` fields are correctly typed.
    *   *Verification:* Fields `id` is a UUID, `timestamp` is a valid ISO string, and `facts` is a string array.

#### 3. Recalling (`lib/memory/memfork.ts`)
*   **Test Case 3.1: Recall empty branch**
    *   *Input:* `branchId: "feature-a"` (with no commits).
    *   *Output:* Resolves to `[]`.
    *   *Verification:* Ensure empty array is returned instead of `null` or undefined.
*   **Test Case 3.2: Recall single commit**
    *   *Input:* `branchId: "feature-a"` (with single commit from Case 2.1).
    *   *Output:* `["Add core DB"]`.
    *   *Verification:* Recalled facts matches exactly.
*   **Test Case 3.3: Recall accumulated commits**
    *   *Input:* `branchId: "feature-a"` (after Case 2.2).
    *   *Output:* `["Add core DB", "Use child_process"]`.
    *   *Verification:* Facts are accumulated along the commit lineage.
*   **Test Case 3.4: Recall child branch inheriting parent**
    *   *Input:* `branchId: "feature-b"` (branched from `"feature-a"` after Case 2.2).
    *   *Output:* `["Add core DB", "Use child_process"]`.
    *   *Verification:* Child branch starts with all parent facts recalled correctly.
*   **Test Case 3.5: Recall isolation**
    *   *Input:* Commit a unique fact on `"feature-b"`, then recall `"feature-a"`.
    *   *Output:* `"feature-a"` facts do not include `"feature-b"`'s unique fact.
    *   *Verification:* Confirms isolation of child commits from their parents.

#### 4. DB Persistence (`lib/db/db.ts`)
*   **Test Case 4.1: Auto-initialization**
    *   *Input:* Delete `.memfork/db.test.json`, trigger DB read.
    *   *Output:* Initializes default DB structure.
    *   *Verification:* File is created and contains empty collection keys.
*   **Test Case 4.2: Atomic writes**
    *   *Input:* Write to database.
    *   *Output:* Write succeeds.
    *   *Verification:* File is updated. Assert that a temporary file `.tmp` was used and renamed to guarantee atomicity.
*   **Test Case 4.3: Session survival**
    *   *Input:* Write branches/commits, clear memory cache, and load from database.
    *   *Output:* Returned data matches exactly.
    *   *Verification:* Assert correct serialization and deserialization.
*   **Test Case 4.4: Concurrent reads and writes**
    *   *Input:* Trigger 20 parallel writes to DB.
    *   *Output:* All writes resolve.
    *   *Verification:* File is valid JSON and final state reflects all operations without losing data.
*   **Test Case 4.5: Validation on write**
    *   *Input:* Write invalid schema (e.g. missing `facts` in a commit record).
    *   *Output:* Rejects write or automatically supplies defaults.
    *   *Verification:* Database file is not corrupted.

#### 5. Agent Invocation (`lib/agents/orchestrator.ts`)
*   **Test Case 5.1: Research Agent execution**
    *   *Input:* Prompt: "Explain database options" on `branch-research`.
    *   *Output:* Research analysis with alternatives and tradeoffs.
    *   *Verification:* Contains fact statements like "Relational databases support ACID transactions".
*   **Test Case 5.2: Critic Agent execution**
    *   *Input:* Prompt: "Critique PostgreSQL usage" on `branch-critic`.
    *   *Output:* Critic analysis highlighting weaknesses.
    *   *Verification:* Identifies weaknesses like "PostgreSQL struggles with horizontal scaling".
*   **Test Case 5.3: Builder Agent execution**
    *   *Input:* Prompt: "Propose Postgres implementation" on `branch-builder`.
    *   *Output:* Step-by-step implementation.
    *   *Verification:* Outputs concrete deployment options (e.g. "Deploy on AWS RDS").
*   **Test Case 5.4: Response parsing**
    *   *Input:* Raw LLM output containing embedded facts.
    *   *Output:* Parsed clean array of facts.
    *   *Verification:* Noise statements (e.g. "Here are the facts:") are removed.
*   **Test Case 5.5: Sequential orchestration**
    *   *Input:* Run all three agents sequentially.
    *   *Output:* Three commits on respective branches.
    *   *Verification:* Verify DAG displays three distinct linear developments.

#### 6. Semantic Diffing (`lib/memory/merge.ts`)
*   **Test Case 6.1: Diff identical branches**
    *   *Input:* `factsA: ["Use Postgres"]`, `factsB: ["Use Postgres"]`
    *   *Output:* `{ shared: ["Use Postgres"], uniqueA: [], uniqueB: [] }`
    *   *Verification:* Matches output structure.
*   **Test Case 6.2: Diff disjoint branches**
    *   *Input:* `factsA: ["Use Postgres"]`, `factsB: ["Use Neo4j"]`
    *   *Output:* `{ shared: [], uniqueA: ["Use Postgres"], uniqueB: ["Use Neo4j"] }`
    *   *Verification:* Matches output.
*   **Test Case 6.3: Diff partially overlapping branches**
    *   *Input:* `factsA: ["A", "B"]`, `factsB: ["B", "C"]`
    *   *Output:* `{ shared: ["B"], uniqueA: ["A"], uniqueB: ["C"] }`
    *   *Verification:* Correct partition.
*   **Test Case 6.4: Diff against parent**
    *   *Input:* Diff child branch facts against original parent facts.
    *   *Output:* Only child commits are classified as unique to the child.
    *   *Verification:* Matches expected lineage.
*   **Test Case 6.5: Semantic equivalence classification**
    *   *Input:* `factsA: ["Use PostgreSQL"]`, `factsB: ["use postgresql."]`.
    *   *Output:* Classified as shared (ignoring casing and periods).
    *   *Verification:* Case-insensitivity and formatting normalization tests pass.

#### 7. Conflict Detection (`lib/memory/merge.ts`)
*   **Test Case 7.1: Direct contradiction**
    *   *Input:* `factsA: ["Use PostgreSQL"]`, `factsB: ["Do not use PostgreSQL"]`
    *   *Output:* Returns a `Conflict` object for these statements.
    *   *Verification:* Assert conflicts array contains exactly one item.
*   **Test Case 7.2: Semantic contradiction**
    *   *Input:* `factsA: ["Write backend in Go"]`, `factsB: ["Write backend in Python"]`
    *   *Output:* Returns conflict detailing the language contradiction.
    *   *Verification:* Assert semantic matcher detects conflicting technology selections.
*   **Test Case 7.3: Compatible additions**
    *   *Input:* `factsA: ["Use Tailwind for CSS"]`, `factsB: ["Use TypeScript for code safety"]`
    *   *Output:* Empty conflicts array (`[]`).
    *   *Verification:* Clean pass.
*   **Test Case 7.4: Conflict detail fields**
    *   *Input:* Opposing facts.
    *   *Output:* Conflict details array.
    *   *Verification:* Contains target keys: `factA`, `factB`, `reason`, and `severity`.
*   **Test Case 7.5: Deduplicated check**
    *   *Input:* Same conflicting fact committed twice in target.
    *   *Output:* Unique list of conflicts (no duplicates in conflict reports).

#### 8. Merging (`lib/memory/merge.ts`)
*   **Test Case 8.1: Conflict-free merge**
    *   *Input:* Merge `feature-a` (compatible facts) into `main`.
    *   *Output:* Creates merge commit.
    *   *Verification:* Recalled facts on `main` contain combined facts from both.
*   **Test Case 8.2: Fast-forward merge**
    *   *Input:* Merge `feature-a` into `main` when `main` hasn't progressed since branch point.
    *   *Output:* Pointers updated.
    *   *Verification:* Verify head commit of `main` is now identical to `feature-a`.
*   **Test Case 8.3: Merge with manual resolutions**
    *   *Input:* Merge conflicting branches with a `resolvedFacts` array containing selection.
    *   *Output:* Creates merge commit with the specified resolved facts.
    *   *Verification:* Recalled target facts match the provided `resolvedFacts`.
*   **Test Case 8.4: Merge commit parent linking**
    *   *Input:* Execute merge.
    *   *Output:* Merge commit has multiple parents.
    *   *Verification:* `parentCommit` points to both the previous target head and source head.
*   **Test Case 8.5: Failed merge on unaddressed conflicts**
    *   *Input:* Merge branches with conflicts, without supplying resolution facts.
    *   *Output:* Throws conflict error.
    *   *Verification:* Target branch head commit is unchanged; no merge commit is written.

---

### Tier 2: Boundary & Corner Cases
Verifies system resilience against unexpected, edge, or malformed inputs.

#### 1. Empty Inputs
*   **Test Case 2.1.1: Empty branch name**
    *   *Input:* `memfork branch ""` or `memfork branch "   "`
    *   *Output:* Throws rejection/error.
    *   *Verification:* Assert error response; no branch added to database.
*   **Test Case 2.1.2: Empty fact list commit**
    *   *Input:* `commit(branchId, message, facts: [])`
    *   *Output:* Commits empty array or fails validation.
    *   *Verification:* Commit is rejected or recorded with metadata only, without altering active recalled facts.
*   **Test Case 2.1.3: Empty commit message**
    *   *Input:* `commit(branchId, message: "", facts)`
    *   *Output:* Rejects with descriptive error (e.g. "Commit message cannot be empty").

#### 2. Duplicate Names & Records
*   **Test Case 2.2.1: Re-creating existing branch**
    *   *Input:* `memfork branch "feature-a"` when `"feature-a"` already exists.
    *   *Output:* Fails with error.
    *   *Verification:* Error indicates branch already exists; no duplicate DB ID.
*   **Test Case 2.2.2: Re-submitting identical facts**
    *   *Input:* Commit `["Use Postgres"]` when it is already in the recalled history.
    *   *Output:* Commit recorded but recall output de-duplicates facts.
    *   *Verification:* `recall()` outputs a unique array.

#### 3. Invalid Parents & Lineage
*   **Test Case 2.3.1: Branch from non-existent parent**
    *   *Input:* `memfork branch "new-branch" --from "ghost-parent"`
    *   *Output:* Fails with error (e.g. "Parent branch 'ghost-parent' not found").
*   **Test Case 2.3.2: Commit to non-existent branch**
    *   *Input:* `commit(branchId: "ghost-branch", message, facts)`
    *   *Output:* Fails with error (e.g. "Branch 'ghost-branch' not found").

#### 4. Unresolvable Conflicts
*   **Test Case 2.4.1: Merge with unaddressed conflicts**
    *   *Input:* Attempt to merge `source` containing `"Use Postgres"` into `target` containing `"Use MongoDB"` without a resolution plan.
    *   *Output:* Fails with conflict error.
    *   *Verification:* Verify error details the exact conflict.
*   **Test Case 2.4.2: Invalid resolution list**
    *   *Input:* Resolution includes contradicting statements or facts not present in either source or target.
    *   *Output:* Fails validation.

#### 5. CLI Failures
*   **Test Case 2.5.1: Missing executable handling**
    *   *Input:* Trigger CLI wrapper when path to `memfork` is invalid.
    *   *Output:* Returns rejection "memfork executable not found".
*   **Test Case 2.5.2: CLI execution timeout**
    *   *Input:* Force mock CLI to sleep indefinitely.
    *   *Output:* Child process wrapper terminates and rejects with timeout error.

#### 6. Database Corruption
*   **Test Case 2.6.1: Malformed JSON recovery**
    *   *Input:* Write raw invalid JSON string to `db.test.json`, trigger load.
    *   *Output:* Handles error, backs up malformed file to `db.test.corrupted.json`, and boots with empty DB.
*   **Test Case 2.6.2: Parallel write lockouts**
    *   *Input:* Simultaneously execute 100 updates to the DB.
    *   *Output:* All complete without collision or partial JSON writes.

---

### Tier 3: Cross-Feature Combinations
Tests interactive flows where multiple features intersect.

#### 1. Parallel Multi-Agent Synthesis
*   **Setup:** Initialize `main` branch with requirement: "Build a chat app".
*   **Execution:**
    1. Fork `research-agent`, `critic-agent`, and `builder-agent` in parallel from `main`.
    2. Invoke Research, Critic, and Builder agents in parallel.
    3. Research Agent commits: `["Use WebSockets for real-time messages"]`.
    4. Critic Agent commits: `["WebSockets increase connection state overhead", "Scaling WebSockets requires a Redis Pub/Sub layer"]`.
    5. Builder Agent commits: `["Implement server in Node.js with socket.io", "Use Redis adapter for horizontal scaling"]`.
*   **Verification:**
    *   All three branches are created cleanly.
    *   All commits exist in database.
    *   Parallel execution completes without file-system write lockouts.

#### 2. Double Merge with Semantic Conflict Resolution
*   **Setup:** Use the resulting branches from Parallel Multi-Agent Synthesis (above).
*   **Execution:**
    1. Diff `research-agent` and `critic-agent` to identify overlapping facts.
    2. Merge `research-agent` into `main`. Succeeded (fast-forward/compatible).
    3. Merge `critic-agent` into `main`.
    4. Conflict detected: "Use WebSockets for real-time messages" vs "WebSockets increase connection state overhead".
    5. Pass resolved facts: `["Use WebSockets for real-time messages, configured with scale-out adapter to manage connection state overhead"]`.
    6. Complete merge of `critic-agent`.
    7. Merge `builder-agent` into `main`. Compatible addition merged.
*   **Verification:**
    *   `main` has three merge commits.
    *   Recalled facts on `main` contain the resolved and compatible design statements.
    *   The DAG visualizer query returns a single connected graph ending in `main`'s head.

#### 3. Branching from Merged Pointers
*   **Setup:** From the final merge commit of `main` in the previous test.
*   **Execution:**
    1. Fork `v2-design` from `main`.
    2. Recall facts on `v2-design`.
*   **Verification:**
    *   Recalled facts must match the exact output of `main`'s resolved state, including the historical lineage.

---

### Tier 4: Real-World Application Scenarios
Simulates realistic developer workflows to test long-term stability and user flows.

#### 1. Scenario 4.1: The System Design Workshop (Distributed Cache)
*   **Objective:** Conduct a system design workshop for caching.
*   **Workflow:**
    1. Create base branch `main` with initial fact: `["Build highly available key-value store"]`.
    2. Research Agent forks `main` into `research-cache`, researches options, commits:
        *   `["Redis supports replication and Sentinel"]`
        *   `["Redis supports RDB/AOF persistence"]`
    3. Critic Agent forks `main` into `critic-cache`, critiques caching tradeoffs, commits:
        *   `["Redis is single-threaded; long running commands block events"]`
        *   `["Redis in-memory storage loses data on power loss without sync AOF configuration"]`
    4. Builder Agent forks `main` into `builder-cache`, plans implementation, commits:
        *   `["Deploy Redis Sentinel on AWS ECS"]`
        *   `["Configure AOF persistence with everysec policy"]`
    5. Diff the three branches side-by-side.
    6. Merge `research-cache` into `main` (Automatic, succeeds).
    7. Merge `critic-cache` into `main`. Semantic conflict detected between:
        *   `"Redis supports RDB/AOF persistence"` (Research)
        *   `"Redis in-memory storage loses data on power loss without sync AOF configuration"` (Critic)
    8. User resolves conflict manually:
        *   `"Use Redis with AOF persistence configured to everysec to balance performance and power-loss protection"`
    9. Merge `builder-cache` into `main` (Compatible, succeeds).
*   **Expected Results:**
    *   `main` branch updated with merge commits.
    *   Recalled facts list the resolved persistence strategy.
    *   DAG commits match the layout of forks and merges.

#### 2. Scenario 4.2: The Product Feature Pivot (On-Premise to SaaS)
*   **Objective:** Manage a development pivot from On-Premise only to multi-tenant SaaS.
*   **Workflow:**
    1. Create base branch `main` containing initial facts:
        *   `["Target audience: Enterprise banking"]`
        *   `["Deployment model: On-premise air-gapped installations"]`
    2. Research Agent forks `main` into `research-pivot`, researches SaaS requirements, commits:
        *   `["SaaS model enables continuous delivery"]`
        *   `["Multi-tenancy isolation is required"]`
    3. Critic Agent forks `main` into `critic-pivot`, highlights security issues, commits:
        *   `["Multi-tenancy raises cross-tenant data leakage risks"]`
        *   `["SaaS model conflicts with air-gapped compliance requirements"]`
    4. Builder Agent forks `main` into `builder-pivot`, outlines architecture, commits:
        *   `["Deploy multi-tenant architecture on AWS with database-level schemas per tenant"]`
    5. Trigger merge of `research-pivot` into `main`.
    6. System detects conflict with `"Deployment model: On-premise air-gapped installations"`.
    7. AI-assisted resolution resolves the contradiction to:
        *   `"SaaS model for SME banking, maintaining optional On-premise air-gapped installations for Tier 1 Enterprise banks"`
    8. Merge completes.
*   **Expected Results:**
    *   Merge successfully creates commit.
    *   Air-gapped and SaaS hybrid strategy is reflected in recalled facts.

---

## 4. Programmatic Verification Runner

The test suite is driven by a programmatic Node.js test runner at `scripts/run-e2e.js`. This runner executes tests, handles setup/teardown, configures mocking, and exits with appropriate codes.

### Runner Interface & Flags
*   `node scripts/run-e2e.js` - Runs all test cases across all tiers.
*   `node scripts/run-e2e.js --tier 1` - Runs only Tier 1 (Feature Coverage) tests.
*   `node scripts/run-e2e.js --tier 2` - Runs only Tier 2 (Boundary & Corner) tests.
*   `node scripts/run-e2e.js --tier 3` - Runs only Tier 3 (Cross-Feature Combination) tests.
*   `node scripts/run-e2e.js --tier 4` - Runs only Tier 4 (Real-World Scenario) tests.
*   `node scripts/run-e2e.js --verbose` - Includes detailed debug execution logging.

### Script Integration (`package.json`)
The test suite is mapped to the standard npm command lifecycle:
```json
{
  "scripts": {
    "test": "node scripts/run-e2e.js",
    "test:tier1": "node scripts/run-e2e.js --tier 1",
    "test:tier2": "node scripts/run-e2e.js --tier 2",
    "test:tier3": "node scripts/run-e2e.js --tier 3",
    "test:tier4": "node scripts/run-e2e.js --tier 4",
    "verify": "node scripts/verify-project.js"
  }
}
```

The verification script `scripts/verify-project.js` executes the E2E test suite programmatically using `child_process.fork()` or `child_process.execSync()` and maps success/failure to its own validation reports, enforcing that no release is marked valid unless **100% of E2E tests pass**.
