# Project: AgentOS Memory Lab

## Architecture
- **Framework**: Next.js 15 (App Router), React 19, Tailwind CSS, TypeScript, shadcn/ui.
- **Memory Engine**: MemForks CLI child_process wrapper.
  - Executable: `memfork`
  - Operations: branch, commit, recall.
- **State Persistence**: Local JSON DB at `.memfork/db.json` containing:
  - Branches (id, name, parentBranchId, etc.)
  - Commits (id, branchId, message, facts[], parentCommit, timestamp)
  - Conversations & Messages (id, branchId, role, content, agentType, timestamp)
- **Multi-Agent Orchestration**:
  - Research Agent: Fact-gathering, alternatives, tradeoffs.
  - Critic Agent: Assumes counter-arguments, weaknesses, contradictions.
  - Builder Agent: Architecture, strategy, recommendations.
- **DAG Visualizer**: React Flow commit graph.
- **Diff & Merge Engine**:
  - Diff: Categorizes shared facts and unique facts.
  - Merge: Compares source and target facts, detects semantic contradictions (e.g. Postgres vs Neo4j), creates proposals, supports manual/AI resolution, creates merge commit.

## Code Layout
- `app/` - App Router page routes, APIs, and root layout.
- `components/` - React components (sidebar, chat, DAG, diff, modals).
- `lib/` - Shared services and utilities:
  - `lib/memory/` - `memfork.ts` (CLI wrapper), `diff.ts`, `merge.ts`.
  - `lib/agents/` - Specialist agents logic and LLM orchestration.
  - `lib/db/` - Local JSON DB CRUD operations (`db.ts`).
  - `lib/types/` - Shared TypeScript interfaces.
  - `lib/utils/` - Global Tailwind/shadcn utility functions.
- `actions/` - Next.js Server Actions for branch/chat/agent operations.
- `hooks/` - React hooks (e.g. fetching state).
- `scripts/` - Project verification script `verify-project.js`.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Core DB & CLI Wrapper | CLI wrapper `memfork.ts`, `.memfork/db.json` setup, basic models | None | DONE |
| M2 | Multi-Agent Orchestration | Research, Critic, and Builder agent configs and parallel execution logic | M1 | DONE |
| M3 | Merge & Diff Engine | Fact categorizer, semantic contradiction detector, merge proposal, conflict resolver | M1 | DONE |
| M4 | Frontend UI & visualizers | App Router page, Sidebar, Chat, React Flow DAG, Diff View, Modals | M2, M3 | IN_PROGRESS (f74fca8f-cca0-4659-bc38-fc9106be21eb) |
| M5 | E2E Integration Pass | Integration verification, passing 100% E2E tests, Tier 5 hardening | M4, E2E | IN_PROGRESS (f74fca8f-cca0-4659-bc38-fc9106be21eb) |

## Interface Contracts
### Memfork Wrapper (`lib/memory/memfork.ts`)
- `branch(name: string, from?: string): Promise<void>`
- `commit(branchId: string, message: string, facts: string[]): Promise<MemoryCommit>`
- `recall(branchId: string): Promise<string[]>`

### Local DB Helpers (`lib/db/db.ts`)
- Schema mapping for all entity models.
- Read/write operations with atomic updates.

### Multi-Agent Orchestration (`lib/agents/orchestrator.ts`)
- Parallel branch creation and parallel agent invocations.
- Parsing agent outputs to extract committed facts.

### Merge & Diff Engine (`lib/memory/merge.ts`)
- `diffFacts(factsA: string[], factsB: string[]): { shared: string[], uniqueA: string[], uniqueB: string[] }`
- `detectConflicts(factsA: string[], factsB: string[]): Promise<Conflict[]>`
- `mergeBranches(sourceBranchId: string, targetBranchId: string, resolvedFacts: string[]): Promise<MemoryCommit>`
