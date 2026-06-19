# Test Infrastructure Design: AgentOS Memory Lab E2E Testing Architecture

This document describes the design, architecture, database isolation strategies, mock CLI mechanisms, and comprehensive test suite hierarchy for end-to-end (E2E) testing of the AgentOS Memory Lab.

---

## 1. E2E Testing Architecture Overview

The testing architecture ensures that all layers of the application—from the command-line interface wrapper up to multi-agent parallel workflows, semantic diffing, and merging—are programmatically verified without mutating development or production data.

### Directory Layout
The testing resources are structured as follows:
```text
C:\Users\USER\antigravitycliproject\memfork\
├── scripts/
│   ├── run-e2e.js          # The Node.js test runner execution script
│   └── mock-memfork.js     # The mock CLI for headless / test environments
├── tests/
│   └── e2e/
│       ├── tier1_features.test.js    # Tier 1: Core feature coverage
│       ├── tier2_boundaries.test.js  # Tier 2: Edge & corner cases
│       ├── tier3_combinations.test.js# Tier 3: Cross-feature combinations
│       └── tier4_scenarios.test.js   # Tier 4: E2E real-world workflows
└── TEST_INFRA.md           # This architecture & case design document (proposed)
```

### Flow of Execution
1. **Invoking Runner**: Running `node scripts/run-e2e.js` starts the runner.
2. **Environment Setup**: The runner sets environment variables (e.g., `MEMFORK_DB_PATH=.memfork/db.test.json`, `MEMFORK_CLI_PATH=node scripts/mock-memfork.js`).
3. **Database Reset**: The database is initialized to a clean state.
4. **Test Execution**: The runner executes tests tier-by-tier or selectively via arguments.
5. **CLI Wrapping**: Any module invoking `memfork` executes `child_process.exec` pointing to the mock CLI or real executable depending on the environment setup.
6. **Teardown**: The runner cleans up temporary test databases and processes.

---

## 2. Database Isolation & Concurrency Strategy

To prevent testing procedures from overwriting active user sessions or local configs:
- **Environment Isolation**: The Database helper (`lib/db/db.ts`) retrieves the filepath via:
  ```typescript
  const dbPath = process.env.MEMFORK_DB_PATH || '.memfork/db.json';
  ```
- **Test Initialization**: Before each test suite runs, `db.test.json` is overwritten with an empty database template:
  ```json
  {
    "branches": [{ "id": "main", "name": "main", "parentBranchId": null }],
    "commits": [],
    "conversations": [],
    "messages": []
  }
  ```
- **Atomic Concurrency**: To simulate and verify thread-safe DB transactions under parallel agent executions, the DB helper uses a file-locking queue (e.g., using `fs.promises.writeFile` with temporary file renaming or a lockfile library). E2E tests specifically invoke rapid parallel updates to verify that database state does not corrupt.

---

## 3. Mock CLI Executable Solution (`scripts/mock-memfork.js`)

Because the compiled Rust or Go-based `memfork` executable may not be available on all test machines initially, a programmatic mock CLI ensures tests run reliably.

### Command Execution Hijacking
The environment variable `MEMFORK_CLI_EXEC` is defined during tests. The wrapper `lib/memory/memfork.ts` delegates to:
```typescript
const cliCommand = process.env.MEMFORK_CLI_EXEC || 'memfork';
```
When running E2E tests, the runner sets `MEMFORK_CLI_EXEC="node C:\\Users\\USER\\antigravitycliproject\\memfork\\scripts\\mock-memfork.js"`.

### Mock CLI Architecture
Since each CLI execution is a separate process spawn, the mock CLI must maintain state out-of-process.
- **State File**: The mock CLI writes its branch commits to `.memfork/cli-memory.test.json`.
- **Command Handling**:
  - `branch <name> --from <parent>`: Validates that parent exists in `cli-memory.test.json` and creates a new branch record.
  - `commit -m <message> --facts <facts>`: Parses the comma-separated facts, pushes them to the branch's commit list, and generates a new commit ID.
  - `recall <branch>`: Traverses the commit tree starting from the target branch up to the root, accumulating facts in history order, and prints them to stdout.

---

## 4. Test Tiers & Test Case Specifications

### Tier 1: Feature Coverage
Verify that each system feature works under normal conditions. (At least 5 cases per feature).

#### 1. Branching Operations
*   **Case 1.1: Create Root Branch**
    *   *Description*: Create the initial 'main' branch if it doesn't exist.
    *   *Input*: `branch("main")`
    *   *Expected*: Succeeds. Database has a branch entry with `id: "main"`, `parentBranchId: null`.
*   **Case 1.2: Fork Child Branch**
    *   *Description*: Fork a new branch 'research' from 'main'.
    *   *Input*: `branch("research", "main")`
    *   *Expected*: Succeeds. Database has a branch entry with `id: "research"`, `parentBranchId: "main"`.
*   **Case 1.3: Fork Multiple Siblings**
    *   *Description*: Fork 'critic' and 'builder' from 'main'.
    *   *Input*: `branch("critic", "main")`, `branch("builder", "main")`
    *   *Expected*: Both branches created. DB shows both having `parentBranchId: "main"`.
*   **Case 1.4: Deep Nesting**
    *   *Description*: Fork 'deep-critic' from 'critic'.
    *   *Input*: `branch("deep-critic", "critic")`
    *   *Expected*: Succeeds. Parent link chain resolves as `deep-critic` -> `critic` -> `main`.
*   **Case 1.5: List Active Branches**
    *   *Description*: Fetch the list of active branches.
    *   *Input*: Database query for all branch records.
    *   *Expected*: Returns a list containing 'main', 'research', 'critic', 'builder', and 'deep-critic'.

#### 2. Committing Facts
*   **Case 1.6: Commit Single Fact**
    *   *Description*: Commit one key fact to 'main'.
    *   *Input*: `commit("main", "Initial fact", ["PostgreSQL is chosen for transactions"])`
    *   *Expected*: New commit created. Returns `MemoryCommit` with the fact, message, and correct branch ID.
*   **Case 1.7: Commit Multiple Facts**
    *   *Description*: Commit multiple facts to 'research'.
    *   *Input*: `commit("research", "Add DB findings", ["Neo4j is great for graphs", "Neo4j uses Cypher query language"])`
    *   *Expected*: Commit holds both facts inside the `facts` array.
*   **Case 1.8: Commit Order Integrity**
    *   *Description*: Verify that subsequent commits reference their preceding commits.
    *   *Input*: Execute two sequential commits on `research`.
    *   *Expected*: The second commit's `parentCommit` field matches the first commit's ID.
*   **Case 1.9: Fact Structure Formatting**
    *   *Description*: Verify that facts committed are stripped of unnecessary markdown or line breaks.
    *   *Input*: `commit("main", "Clean facts", ["  Clean Fact 1. \n", "Clean Fact 2 "])`
    *   *Expected*: Facts in DB stored as `["Clean Fact 1.", "Clean Fact 2"]`.
*   **Case 1.10: Commit Map Typing**
    *   *Description*: Verify `MemoryCommit` interface adherence.
    *   *Input*: Extract commit object from database.
    *   *Expected*: Contains `id` (string), `branchId` (string), `message` (string), `facts` (array of strings), `parentCommit` (string or null), `timestamp` (number).

#### 3. Recalling Facts
*   **Case 1.11: Recall Empty Branch**
    *   *Description*: Recall memory on a branch with no commits.
    *   *Input*: `recall("empty-branch")`
    *   *Expected*: Returns an empty array `[]`.
*   **Case 1.12: Recall Direct Commit Facts**
    *   *Description*: Recall facts from a branch containing one commit.
    *   *Input*: `recall("main")`
    *   *Expected*: Returns the list of facts from `main`'s single commit.
*   **Case 1.13: Recall Accumulated Branch History**
    *   *Description*: Recall facts after multiple commits on the same branch.
    *   *Input*: `recall("research")`
    *   *Expected*: Returns all facts from all commits on `research` in order of creation.
*   **Case 1.14: Inherited Recall**
    *   *Description*: Recall facts from a child branch.
    *   *Input*: `recall("critic")` where 'main' has commits and 'critic' has commits.
    *   *Expected*: Returns a combined array of 'main' facts followed by 'critic' facts.
*   **Case 1.15: Shadowing / Deduplication in Inheritance**
    *   *Description*: Verify that identical facts across history are deduplicated upon recall.
    *   *Input*: Commit "Neo4j uses Cypher" to 'main' and 'research'. Call `recall("research")`.
    *   *Expected*: Fact list contains "Neo4j uses Cypher" only once.

#### 4. Local DB Persistence
*   **Case 1.16: Cold Start DB Load**
    *   *Description*: Verify that the database module reads the JSON file correctly on startup.
    *   *Input*: Create `db.json` with pre-defined structures. Import and initialize the database.
    *   *Expected*: DB module returns the correct pre-populated records.
*   **Case 1.17: Atomic Transactional Commit**
    *   *Description*: Verify that writes are synchronized to prevent partial corruption.
    *   *Input*: Perform multiple concurrent writes.
    *   *Expected*: The JSON file is written completely with no missing or parsed syntax errors.
*   **Case 1.18: Message History Retrieval**
    *   *Description*: Save messages and verify they are stored and loaded correctly.
    *   *Input*: Save message list under conversation ID.
    *   *Expected*: Retrieved messages contain `id`, `branchId`, `role`, `content`, `agentType`, and `timestamp`.
*   **Case 1.19: Branch Metadata Modifications**
    *   *Description*: Update branch details (e.g., active state, name).
    *   *Input*: Modify branch metadata via DB API.
    *   *Expected*: Changes reflect in `db.json` and are persisted across instances.
*   **Case 1.20: Database Teardown Cleanliness**
    *   *Description*: Validate database purge utilities.
    *   *Input*: Call database deletion or initialization utilities.
    *   *Expected*: File is deleted or reset to baseline schema.

#### 5. Multi-Agent Orchestration
*   **Case 1.21: Research Agent Prompt Delivery**
    *   *Description*: Verify that the Research Agent system prompt is structured for fact-gathering.
    *   *Input*: Instantiate Research Agent.
    *   *Expected*: System prompt contains constraints for fact identification, alternatives, and tradeoffs.
*   **Case 1.22: Critic Agent Prompt Delivery**
    *   *Description*: Verify the Critic Agent system prompt.
    *   *Input*: Instantiate Critic Agent.
    *   *Expected*: System prompt focuses on highlighting weaknesses, contradictions, and challenging assumptions.
*   **Case 1.23: Builder Agent Prompt Delivery**
    *   *Description*: Verify the Builder Agent system prompt.
    *   *Input*: Instantiate Builder Agent.
    *   *Expected*: System prompt focuses on implementation, optimization, and software architecture.
*   **Case 1.24: Parallel Agent Dispatching**
    *   *Description*: Verify orchestrator launches agents concurrently on separate branches.
    *   *Input*: Call orchestrator with 3 specialized agents.
    *   *Expected*: 3 separate branches are spawned and agent tasks run in parallel.
*   **Case 1.25: Fact Extraction from LLM Output**
    *   *Description*: Verify that the parser extracts structured facts from unstructured LLM chat outputs.
    *   *Input*: LLM response string with embedded facts (e.g., in a Markdown list or JSON structure).
    *   *Expected*: Returns a clean array of string facts ready for commit.

#### 6. Semantic Diffing
*   **Case 1.26: Diff Identical Branches**
    *   *Description*: Compare branches with the exact same facts.
    *   *Input*: `diffFacts(["A", "B"], ["A", "B"])`
    *   *Expected*: `{ shared: ["A", "B"], uniqueA: [], uniqueB: [] }`
*   **Case 1.27: Diff Disjoint Branches**
    *   *Description*: Compare branches with entirely distinct facts.
    *   *Input*: `diffFacts(["A"], ["B"])`
    *   *Expected*: `{ shared: [], uniqueA: ["A"], uniqueB: ["B"] }`
*   **Case 1.28: Diff Partially Overlapping Branches**
    *   *Description*: Compare branches with overlapping and unique facts.
    *   *Input*: `diffFacts(["A", "B"], ["B", "C"])`
    *   *Expected*: `{ shared: ["B"], uniqueA: ["A"], uniqueB: ["C"] }`
*   **Case 1.29: Case Insensitivity Handling**
    *   *Description*: Verify if diffing handles casing deviations.
    *   *Input*: `diffFacts(["Postgres"], ["postgres"])`
    *   *Expected*: Categorizes them based on normalization rules (either shared or unique, depending on design specs).
*   **Case 1.30: Multi-word Fact Diffing**
    *   *Description*: Check if complex phrases are diffed properly.
    *   *Input*: `diffFacts(["Use PostgreSQL for transactions"], ["Use PostgreSQL for user transactions"])`
    *   *Expected*: Identified as unique facts in both branches.

#### 7. Conflict Detection
*   **Case 1.31: Conflict Detection: Compatible Facts**
    *   *Description*: Run conflict detection on facts that do not oppose each other.
    *   *Input*: `detectConflicts(["Use PostgreSQL for tables"], ["Use Neo4j for graphs"])`
    *   *Expected*: Empty conflict array `[]`.
*   **Case 1.32: Conflict Detection: Contradictory Statements**
    *   *Description*: Detect direct contradictions.
    *   *Input*: `detectConflicts(["Primary DB is Postgres"], ["Primary DB is Neo4j"])`
    *   *Expected*: Returns conflict entry highlighting the contradictory pair.
*   **Case 1.33: Conflict Detection: Port Contradiction**
    *   *Description*: Detect opposing port mappings.
    *   *Input*: `detectConflicts(["Postgres port is 5432"], ["Postgres port is 5433"])`
    *   *Expected*: Conflict detected for PostgreSQL port configuration.
*   **Case 1.34: Semantic Contrast Detection**
    *   *Description*: Identify contradiction when phrasing differs but semantic meaning is opposite (e.g. "We will scale vertically" vs "We will scale horizontally").
    *   *Input*: `detectConflicts(["We will scale vertically"], ["We will scale horizontally"])`
    *   *Expected*: Conflict flagged.
*   **Case 1.35: Scale / Limits Contradictions**
    *   *Description*: Check numerical constraints.
    *   *Input*: `detectConflicts(["Connection pool max is 20"], ["Max connection pool size is 100"])`
    *   *Expected*: Conflict flagged.

#### 8. Merging Operations
*   **Case 1.36: Non-Conflicting Auto-Merge**
    *   *Description*: Merge branch when there are no conflicting facts.
    *   *Input*: `mergeBranches("research", "main", ["Postgres is selected", "Neo4j is selected"])`
    *   *Expected*: A merge commit is created on `main`. `recall("main")` contains the merged facts.
*   **Case 1.37: Conflict Resolution (Choice A)**
    *   *Description*: Merge with a conflict resolved by selecting Branch A's fact.
    *   *Input*: Conflicting facts "Use Postgres" (A) vs "Use Neo4j" (B). User selects "Use Postgres".
    *   *Expected*: Merge commit has "Use Postgres" only.
*   **Case 1.38: Conflict Resolution (Choice B)**
    *   *Description*: Merge with a conflict resolved by selecting Branch B's fact.
    *   *Input*: Conflicting facts "Use Postgres" (A) vs "Use Neo4j" (B). User selects "Use Neo4j".
    *   *Expected*: Merge commit has "Use Neo4j" only.
*   **Case 1.39: Conflict Resolution (Synthesis/Custom)**
    *   *Description*: Merge with a conflict resolved via custom synthesized fact.
    *   *Input*: Resolved fact: "Use PostgreSQL for relational and Neo4j for graphs".
    *   *Expected*: Merge commit includes this custom fact.
*   **Case 1.40: Merged DAG Link Integration**
    *   *Description*: Verify parent commits of a merge commit link to both source and target tips.
    *   *Input*: Inspect the created merge commit's parent pointers.
    *   *Expected*: The merge commit contains multiple parent commit IDs.

---

### Tier 2: Boundary & Corner Cases
Verify system resilience against erroneous, excessive, or malformed inputs.

*   **Case 2.1: Empty Branch Name Validation**
    *   *Input*: `branch("", "main")` or `branch(null, "main")`
    *   *Expected*: Fails validation before executing commands. Throws descriptive error.
*   **Case 2.2: Invalid Branch Name Special Characters**
    *   *Input*: `branch("research; rm -rf /", "main")`
    *   *Expected*: Character sanitization prevents command injection. Fails validation.
*   **Case 2.3: Non-existent Parent Branch**
    *   *Input*: `branch("new-branch", "fake-parent-id-123")`
    *   *Expected*: Fails. Validation warns that the parent branch does not exist.
*   **Case 2.4: Branch Forking Cycle Protection**
    *   *Input*: Fork branch 'A' from 'B', fork 'B' from 'C', then try to fork 'C' from 'A'.
    *   *Expected*: Cycle detection engine prevents creating cyclic parentage in the DB schema.
*   **Case 2.5: Commit Empty Facts**
    *   *Input*: `commit("main", "Empty commit message", [])`
    *   *Expected*: Rejects empty commit facts, or registers a no-op commit with empty facts.
*   **Case 2.6: Massive Fact Array Load**
    *   *Input*: Commit a fact list containing 10,000 distinct items, or a fact containing 1MB of text.
    *   *Expected*: Handled cleanly without stack overflows, database locks, or command truncation.
*   **Case 2.7: Call Recall on Non-existent Branch**
    *   *Input*: `recall("imaginary-branch-xyz")`
    *   *Expected*: Returns error detailing that the branch does not exist.
*   **Case 2.8: CLI Wrapper Execution Interruption / Non-Zero Exit**
    *   *Input*: Simulate the CLI binary failing or returning exit code `1`.
    *   *Expected*: Next.js server actions handle this child_process rejection cleanly.
*   **Case 2.9: Concurrency Lock Stress**
    *   *Input*: 50 parallel DB write calls executing concurrently.
    *   *Expected*: Database queue processes them sequentially. No files are left corrupted or half-written.
*   **Case 2.10: Self-Merge Attempt**
    *   *Input*: Attempt to merge 'main' into 'main'.
    *   *Expected*: Aborted. Warns that source and target branches cannot be identical.

---

### Tier 3: Cross-Feature Combinations
Verify integrity when multiple features interact.

*   **Case 3.1: Parallel Multi-Branch Execution**
    *   *Description*: Research and Critic agents concurrently fork and commit.
    *   *Input*: Two parallel agents call `branch` and then `commit` on their respective branches concurrently.
    *   *Expected*: Both branches are created, both commits succeed, and parent commits correctly map to `main` without race conditions.
*   **Case 3.2: Multi-Branch Commit-Diff-Merge Loop**
    *   *Description*: Perform successive branch operations.
    *   *Input*:
        1. Fork `branch-a` and `branch-b` from `main`.
        2. Commit to `branch-a`, then commit to `branch-b`.
        3. Diff `branch-a` and `branch-b`, resolve conflicts, and merge `branch-a` into `branch-b`.
        4. Commit new facts to `branch-b`.
        5. Merge `branch-b` into `main`.
    *   *Expected*: Full history is visible in DAG, and final `main` branch contains all facts in correct dependency order.
*   **Case 3.3: CLI Failure Mid-Transaction Recovery**
    *   *Description*: Test DB state stability after CLI failure.
    *   *Input*: Call a transaction sequence: (1) Save DB entry (2) Execute CLI commit (which is forced to fail) (3) Undo DB changes.
    *   *Expected*: DB state rollback prevents database and CLI files from drifting out of sync.
*   **Case 3.4: Complex DAG Visualization Export Validation**
    *   *Description*: Verify node and edge structures outputted for React Flow.
    *   *Input*: A database containing 10 commits, 4 branches, and 3 merges.
    *   *Expected*: React Flow parsing helper generates unique node IDs matching all commit hashes, with edge target/source relationships representing all parentCommit paths.
*   **Case 3.5: Chat Conversation Branch Separation**
    *   *Description*: Verify conversation isolation.
    *   *Input*: Write messages on `branch-research`, switch active UI branch to `branch-critic` and write messages, then recall `branch-research`.
    *   *Expected*: Conversations remain scoped strictly to their respective branch IDs.

---

### Tier 4: Real-World Application Scenarios
Verify full business workflows end-to-end.

*   **Scenario 4.1: Database Choice Decision (Neo4j vs PostgreSQL)**
    *   *Flow*:
        1. **User Prompt**: "Evaluate Postgres vs Neo4j for our graph recommendation app."
        2. **Orchestrator Action**: Fork branches `branch-research`, `branch-critic`, and `branch-builder` from `main`.
        3. **Research Agent parallel execution**:
           * Gathers facts on both databases.
           * Commits: `["PostgreSQL is relational", "Neo4j is graph-based", "Neo4j traverses edges in O(1) time"]` to `branch-research`.
        4. **Critic Agent parallel execution**:
           * Identifies bottlenecks.
           * Commits: `["Neo4j has high memory overhead", "PostgreSQL requires joins which slow down at depth"]` to `branch-critic`.
        5. **Builder Agent parallel execution**:
           * Proposes architecture.
           * Commits: `["Use PostgreSQL as primary database", "Cache recommendations in Neo4j"]` to `branch-builder`.
        6. **Diffing**: Diff all branches. Identify no direct contradiction, but distinct approaches.
        7. **Conflict Resolution**: Simulate an AI resolver which merges them into a single coherent document: `["PostgreSQL is primary database", "Neo4j caches recommendations to enable O(1) edge traversal", "Mitigates high Neo4j memory overhead and PostgreSQL deep join slowdowns"]`.
        8. **Final Merge**: Merge into `main` with a merge commit.
    *   *Verification*:
        *   `recall("main")` returns the final 3-fact summary.
        *   The DB has exactly 3 agent branches.
        *   The CLI history has 4 commits (1 per agent + 1 merge commit).
        *   React Flow DAG has 4 nodes and 3 edges representing the merge paths.

---

## 5. Execution Guide & Programmatic Verification

To execute the test suite programmatically and verify code logic:

### Running the Tests
A verification command is integrated into `package.json`:
```bash
npm run test:e2e
```
Or run the runner script directly with flags:
```bash
# Run all test tiers
node scripts/run-e2e.js

# Run specific tier
node scripts/run-e2e.js --tier 1
node scripts/run-e2e.js --tier 2

# Force using mock CLI
node scripts/run-e2e.js --mock-cli
```

### Exit Codes & CI Integration
- **Success**: Exit Code `0` (Outputs a structured green report of all tests passed).
- **Failure**: Exit Code `1` (Outputs red details of failed test case, input values, expected values, and active stack trace).

### Test Output Format Example
```text
=== AGENTOS MEMORY LAB E2E TEST RUNNER ===
[INFO] Setting up test database: .memfork/db.test.json
[INFO] Injecting mock CLI: scripts/mock-memfork.js

--- TIER 1: FEATURE COVERAGE ---
[PASS] Case 1.1: Create Root Branch
[PASS] Case 1.2: Fork Child Branch
[PASS] Case 1.3: Fork Multiple Siblings
...
[PASS] Case 1.40: Merged DAG Link Integration

--- TIER 2: BOUNDARY & CORNER CASES ---
[PASS] Case 2.1: Empty Branch Name Validation
[PASS] Case 2.2: Invalid Branch Name Special Characters
...

=== TEST SUMMARY ===
Tiers Executed: Tier 1, Tier 2, Tier 3, Tier 4
Total Cases: 60
Passed: 60
Failed: 0
Duration: 1.24s

[INFO] Tearing down test database.
[SUCCESS] All E2E tests passed.
```
