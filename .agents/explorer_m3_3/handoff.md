# Handoff Report: Commit DAG & Diff UI Architecture Analysis (Milestone 3)

## 1. Observation

We explored the database schema, memory APIs, agent orchestrator, and component structures in the codebase:
1. **Commit & Branch Schema**:
   In `lib/types/index.ts` (lines 8-16), the `Commit` interface is defined as:
   ```typescript
   export interface Commit {
     id: string;             // Unique identifier (e.g. "c_123")
     branchId: string;       // Target branch ID
     message: string;        // Commit message description
     facts: string[];        // Array of facts asserted in this commit
     parentCommit: string | null; // Parent commit ID in the DAG
     timestamp: number;      // Epoch timestamp (ms)
     retractions?: string[]; // Optional retracted/tombstoned facts
   }
   ```
   In `lib/types/index.ts` (lines 1-6), the `Branch` interface is defined as:
   ```typescript
   export interface Branch {
     id: string;             // Unique identifier (e.g. "b_123" or slug "feature-alpha")
     name: string;           // Display/human-readable name
     parentBranchId: string | null; // ID of the branch this was forked from
     forkCommitId?: string | null; // ID of the parent branch's head commit at branching time
   }
   ```
2. **Merge & Conflict Logic**:
   In `lib/memory/merge.ts` (lines 33-60, 62-72, 269-273), the following functions are exposed:
   ```typescript
   export function diffFacts(factsA: string[], factsB: string[]): { shared: string[], uniqueA: string[], uniqueB: string[] }
   export async function detectConflicts(factsA: string[], factsB: string[]): Promise<Conflict[]>
   export async function mergeBranches(
     sourceBranchId: string,
     targetBranchId: string,
     resolvedFacts: string[] = []
   ): Promise<Commit>
   ```
3. **Database Read/Write**:
   In `lib/db/db.ts` (lines 213-247), the methods `getBranches`, `addBranch`, `getCommits`, `addCommit`, `getMessages`, and `addMessage` are exposed for atomic reads and writes.

4. **Multi-Agent Orchestrator**:
   In `lib/agents/orchestrator.ts` (lines 139-165), parallel agent branch creation and commit operations are executed via:
   ```typescript
   async runParallelPipeline(
     parentBranchId: string,
     prompt: string,
     branchNames?: { researcher?: string; critic?: string; builder?: string }
   ): Promise<{ [role: string]: { branchId: string; commit: Commit } }>
   ```

---

## 2. Logic Chain

From these observations, we trace the logic chain for Milestone 3 implementation:
1. **Interactive Commit DAG**:
   - Because commits are associated with a `branchId` (Obs 1) and have a `parentCommit` pointing to one or more comma-separated parent IDs (Obs 1), we can build a complete graph representation of the repository's history.
   - Because we need to determine the `{x, y}` coordinates of the nodes deterministically in Next.js without third-party layout engines like Dagre (to avoid hydration mismatches), we can compute coordinates by:
     - Assigning branches to vertical lanes (`Y-axis`) using a depth-first traversal of the branch hierarchy starting from `main`.
     - Assigning commits to horizontal generation index columns (`X-axis`) using a recursive longest-path calculation from the root commit (`parentCommit === null`).
   - Because React Flow provides a node-based Canvas renderer with CSS customization, we can represent each commit as a node color-coded by branch type (e.g. green for `main`, blue for `researcher`, red for `critic`, orange for `builder`), with directed edges representing the lineage (from parent to child).

2. **Side-by-Side Diff Viewer**:
   - Because `diffFacts` compares two fact arrays and categorizes them into `shared`, `uniqueA` (Target), and `uniqueB` (Source) (Obs 2), we can fetch this data via a GET `/api/diff` endpoint and render a responsive three-column comparative UI.
   - Because `detectConflicts` takes unique facts from both sides and identifies semantic contradictions (Obs 2), we can highlight conflicting items in red in both the unique columns and compile them into an interactive Conflict Resolution Panel.
   - Because `mergeBranches` accepts a `resolvedFacts` array containing the user's manual/AI resolution choices and writes the resolved merge commit to the database (Obs 2), the Conflict Panel can collect resolved inputs and execute the POST `/api/merge` endpoint to complete the merge cleanly.

---

## 3. Caveats

- We assumed that all commits in the database form a single connected history rooted eventually in a commit with no parent. If orphan commits are present, they will be aligned at `generation = 0` on their respective branch lanes.
- We assumed the user would manually select one of the conflicting facts or write a custom resolution in a text input. AI-assisted resolution prompts can be built later in `lib/agents/orchestrator.ts` as an extension.

---

## 4. Conclusion

We conclude that the proposed architecture using:
1. A topological column-and-row positioning algorithm for React Flow, and
2. A side-by-side three-column difference/conflict resolution component integrated with `lib/memory/merge.ts` API wrappers,
provides a robust, clean, and highly interactive interface that fully satisfies Milestone 3.

---

## 5. Verification Method

To verify this design once implemented:
1. **E2E Test Execution**:
   Run the test suite to ensure existing database, CLI, and merge behaviors are completely intact:
   ```powershell
   npm run verify
   ```
2. **File Check**:
   Confirm that the proposed UI files exist inside `/components/` and `/app/api/` as per the project directory conventions in `PROJECT.md`.
3. **Visual Verification**:
   Ensure the DAG renders correctly when parallel agent branches (Researcher, Critic, Builder) are created and when they are successfully merged back to `main`. Verify that the nodes are color-coded and edges align parent commits to child commits.
