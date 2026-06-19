# Scope: E2E Testing Track

## Architecture
- **E2E Testing Suite**: Located in `tests/e2e/`.
- **Test Runner**: A programmatic Node.js test runner at `scripts/run-e2e.js` that runs all Tiers 1-4 tests, outputs structured test results, and exits with 0 on success, non-zero on failure.
- **Entry Points Tested**:
  - `lib/memory/memfork.ts` (CLI wrappers for branch, commit, recall)
  - `lib/db/db.ts` (JSON Database operations)
  - Next.js Server Actions or API routes (e.g., `actions/branch.ts`, `actions/chat.ts`, etc.) if applicable, or their underlying service controllers.
  - `lib/memory/merge.ts` (diff and semantic merge/conflict detection engine)
  - `lib/agents/orchestrator.ts` (multi-agent execution and logic)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | E2E Test Runner & CLI Mock/Env | Setup test runner, environment configuration, database isolation helpers, mock/wrapper for `memfork` CLI executable. | None | PLANNED |
| M2 | Tier 1: Feature Coverage | Implement Tier 1 tests (5+ cases per feature for Branching, Committing, Recalling, DB persistence, Agent invocation, Semantic Diffing, Conflict Detection, Merging). | M1 | PLANNED |
| M3 | Tier 2: Boundary & Corner Cases | Implement Tier 2 tests (Edge cases, empty inputs, duplicate names, invalid parents, unresolvable conflicts, CLI failures). | M2 | PLANNED |
| M4 | Tier 3: Cross-Feature Combinations | Implement Tier 3 tests (Pairwise feature integration: parallel agents on branches, diffing branches post-commit, merging with conflicts). | M3 | PLANNED |
| M5 | Tier 4: Real-World Scenarios | Implement Tier 4 tests (Complete end-to-end design workflows for multi-agent parallel fact synthesis). | M4 | PLANNED |
| M6 | Publish TEST_READY.md | Finalize and compile E2E test suite, output passing run logs, publish TEST_READY.md, integrate with `npm run verify`. | M5 | PLANNED |

## Interface Contracts
### E2E Test Runner (`scripts/run-e2e.js`)
- Executed via `node scripts/run-e2e.js` (or mapped to `npm test`).
- Supports running individual tiers, e.g., `node scripts/run-e2e.js --tier 1`.
- Outputs verbose, colored, structured test results to stdout.

### Mock CLI `memfork` Wrapper (if real CLI is not available)
- Since the environment might not have the compiled/real `memfork` executable globally available initially, the test runner must allow using a mocked CLI wrapper or a local node-based JS implementation of the memory graph CLI logic, OR we can execute `node scripts/mock-memfork.js` as the `memfork` command.
