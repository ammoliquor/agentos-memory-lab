# Handoff Report: Milestone 3 React Flow DAG & Diff UI

## 1. Observation

- **Project Configuration**: 
  - `package.json` contains:
    ```json
    "reactflow": "^11.10.1"
    ```
    Confirming that React Flow is already a dependency of the project.
- **Database Schema**: 
  - `lib/types/index.ts` lines 8-16 defines `Commit`:
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
  - `lib/types/index.ts` lines 34-41 defines `MergeProposal`:
    ```typescript
    export interface MergeProposal {
      id: string;
      sourceBranchId: string;
      targetBranchId: string;
      status: 'CONFLICT' | 'RESOLVED';
      conflicts: Conflict[]; // Details of detected conflicts
      timestamp: number;
    }
    ```
- **CLI & DB Layer**:
  - `lib/db/db.ts` exposes functions: `getBranches()`, `getCommits()`, `getMessages()`, `addBranch()`, `addCommit()`, `addMessage()`.
  - `lib/memory/merge.ts` contains:
    - Line 33: `diffFacts(factsA: string[], factsB: string[]): { shared: string[], uniqueA: string[], uniqueB: string[] }`
    - Line 62: `detectConflicts(factsA: string[], factsB: string[]): Promise<Conflict[]>`
    - Line 244: `recallFacts(branchId: string, db: DatabaseSchema): string[]`
    - Line 269: `mergeBranches(sourceBranchId: string, targetBranchId: string, resolvedFacts: string[] = []): Promise<Commit>`
- **E2E Testing**:
  - `tests/e2e/tier3_combined.test.js` lines 43-75 validates double merge, conflict proposal detection, and conflict resolution by calling `mergeBranches` with custom `resolvedFacts`.

---

## 2. Logic Chain

1. **DAG Data Structure**: Because the `Commit` model contains a `parentCommit` pointer which supports comma-separated string formatting for multiple parent commits (e.g. `parentCommitStr = "${targetHeadId},${sourceHeadId}"` on line 330 of `lib/memory/merge.ts`), the commit history naturally forms a Directed Acyclic Graph (DAG) that includes both branch forks and merges.
2. **React Flow Nodes & Edges**:
   - Nodes can be created directly from the commit list.
   - Edges can be derived by splitting `parentCommit` on `,`. An edge connects `parentId` to the commit's `id`.
3. **DAG Layout Positioning**: To visualize this graph without overlap, we need a grid layout system:
   - Assigning `y` coordinate based on the branch lane ID (`branchTrackMap[branchId] * 120`).
   - Assigning `x` coordinate based on topological index or chronological ordering sequence (`colIndex * 160`), preventing overlaps of parallel commit flows.
4. **Diff Calculation**: Using `recallFacts` for the target and source pointers provides the set of facts at their HEADs. Calling `diffFacts` categorizes them into shared and unique facts.
5. **Conflict Identification**: Calling `detectConflicts` on the unique facts returns all semantic contradictions, which can be rendered in a dedicated conflicts panel.
6. **Merge flow and Resolution**:
   - Creating a POST API route `/api/merge` that triggers `mergeBranches(source, target)`.
   - Wrapping it with conflict resolution UI: if the API returns a 409 conflict, the client prompts the user to select/edit the facts, and then retry the POST request with the compiled `resolvedFacts` array.

---

## 3. Caveats

- We assumed that all custom visualizations can run using `reactflow` version `11.10.1` in Next.js App Router (using `"use client"` directives for React Flow canvas pages).
- We assumed that diffs can be performed on historical commits as well as branch heads. To fully support this, a helper function `recallFactsAtCommit` must be implemented to retrieve facts up to a specific commit.

---

## 4. Conclusion

Milestone 3's visual interactive DAG and Diff/Merge UI can be cleanly implemented by adding a new path `/dag` with components (`DAGWorkspace`, `CommitDAG`, `DiffViewer`, and `ConflictResolver`) and backing them with API endpoints `/api/dag`, `/api/diff`, and `/api/merge` mapping directly to helper functions in `lib/db/db.ts` and `lib/memory/merge.ts`.

---

## 5. Verification Method

- Inspect `C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m3_2\analysis.md` to review the architecture design.
- Run type check and E2E tests:
  ```powershell
  node scripts/verify-project.js
  ```
