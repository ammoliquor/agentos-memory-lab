# Original User Request

## 2026-06-18T21:57:25Z

An MVP of AgentOS Memory Lab, a multi-agent AI workspace where multiple AI agents think in parallel, maintain isolated branch-specific memory using MemForks, and merge useful insights into a shared knowledge base.

Working directory: `C:\Users\USER\antigravitycliproject\memfork`
Integrity mode: `benchmark`

## Requirements

### R1. UI & Layout (Modern Dark Mode)
- Built using Next.js 15 (App Router), TypeScript, Tailwind CSS, and shadcn/ui.
- Follows a premium developer-aesthetic dark theme (GitHub/Linear/Cursor style).
- **Left Sidebar:** Active branches list and available agents (Research Agent, Critic Agent, Builder Agent).
- **Center:** Chat interface with message history, streaming responses, persistent conversations, branch-specific chats, and agent selector.
- **Right Sidebar:** Memory details panel showing recalled facts, latest commits, and branch facts.
- **Top Bar:** Active branch indicator, "Fork Branch" button, "Compare Branches" (diff) button, and "Merge Branch" button.

### R2. Branching & Memory Operations (MemForks CLI Wrapper)
- Integrate MemForks CLI via child_process shell execution wrapper in the Next.js server actions / API routes.
- Support branch creation: a modal prompting for branch name and parent branch, running `memfork branch <name> --from <parent>`.
- Support wrapping LLM interaction: before generating, retrieve branch memory via `memfork recall`. After generating, parse key facts from LLM output and commit them using `memfork commit -m <message> --facts <facts>`.
- Commits must map to the `MemoryCommit` type containing ID, branchId, message, facts[], parentCommit, and timestamp.

### R3. DAG Visualizer & Diff Viewer
- **DAG Visualizer:** An interactive memory graph rendered using React Flow. Must support zoom, pan, and clicking a commit to inspect its metadata and facts in the sidebar.
- **Diff Viewer:** A side-by-side view comparing two selected branches. Displays Shared facts, Unique facts in Branch A, and Unique facts in Branch B.

### R4. Multi-Agent Orchestration
- Implement three specialized agents with distinct system prompts:
  1. **Research Agent:** Gathers facts, searches alternatives, and identifies tradeoffs.
  2. **Critic Agent:** Challenges assumptions, identifies weaknesses, and detects contradictions.
  3. **Builder Agent:** Proposes implementation strategy, optimizes architecture, and produces technical recommendations.
- Each agent runs in parallel on their respective memory branches.

### R5. Merge Logic & Conflict Resolution
- A merge engine that:
  1. Fetches facts from the source and target branches.
  2. Classifies facts as identical, compatible, or conflicting.
  3. Detects semantic contradictions (e.g., "Use PostgreSQL" vs. "Use Neo4j") rather than simple string mismatch.
  4. Generates a merge proposal and conflict resolution view (supporting manual selection or AI-assisted resolution).
  5. Creates a merge commit on the target branch after resolution.

### R6. Application Persistence
- Persist all user conversations, branch list, and session states in a local JSON database file (located at `.memfork/db.json`).
- Ensure the app is fully functional out-of-the-box using this local DB without requiring external database hosting.

---

## Verification Resources
A programmatic verification script `scripts/verify-project.js` must be created to verify the requirements.

---

## Acceptance Criteria

### A1. Project Completeness & Compilation
- [ ] No compilation or TypeScript errors when running `npm run build` or `npx tsc --noEmit`.
- [ ] Directory structure conforms to the required Next.js App Router workspace (using `/app`, `/components`, `/lib`, `/lib/agents`, `/lib/memory`, `/lib/types`, `/lib/utils`, `/actions`, `/hooks`).

### A2. MemForks & DB Integration
- [ ] A file `lib/memory/memfork.ts` provides shell wrappers for `memfork branch`, `memfork commit`, and `memfork recall`.
- [ ] State is persisted correctly in `.memfork/db.json` and changes are visible after page refresh.

### A3. Logic Verification
- [ ] A verification command `npm run verify` runs `scripts/verify-project.js`.
- [ ] The script automatically tests:
  - Branch creation and commits via the CLI wrapper.
  - Semantic diffing: correctly identifies shared vs. unique facts.
  - Conflict detection: correctly identifies contradictions between opposing facts (e.g. "Use Neo4j" vs. "Use Postgres") and successfully completes a merge.
