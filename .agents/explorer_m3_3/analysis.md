# Architecture and Design Report: Commit DAG & Diff UI (Milestone 3)

This report details the architectural design and implementation proposal for **Milestone 3: React Flow DAG & Diff UI** in the AgentOS Memory Lab.

---

## 1. Executive Summary

The objective is to provide developers and agent systems with an interactive interface to:
1. **Visualize the memory commit DAG (Directed Acyclic Graph)**, highlighting parallel agent operations (Researcher, Critic, Builder), branch forks, and merges.
2. **Diff memory branches side-by-side**, showing shared facts, unique facts, and semantic conflicts.
3. **Resolve conflicts interactively**, allowing developers to select or write custom resolutions to merge branches back into `main`.

We propose a React Flow-based DAG visualizer with a custom topological column/row positioning algorithm, coupled with a three-column side-by-side Diff and Conflict Resolution UI.

---

## 2. Component Architecture & Directory Layout

To align with the project layout defined in `PROJECT.md`, we propose adding the following files:

```
memfork/
├── app/
│   └── api/
│       ├── dag/
│       │   └── route.ts         # GET endpoint returning commits and branches
│       ├── diff/
│       │   └── route.ts         # GET endpoint for branch differences and conflicts
│       └── merge/
│           └── route.ts         # POST endpoint executing merges with resolved facts
├── components/
│   ├── DagVisualizer.tsx       # React Flow canvas component for commit DAG
│   ├── CommitDetailPanel.tsx   # Sidebar panel to inspect clicked commits/facts
│   ├── DiffViewer.tsx          # Side-by-side diff and conflict resolver layout
│   └── ConflictCard.tsx        # Interative resolution card for a single conflict
```

### UI Navigation & Layout Integration
We will integrate a **View Toggle** or **Workspace Tab bar** in the main branch interface (`app/branch/[branchId]/page.tsx`):
- **Chat View**: The existing conversation container (`ChatContainer.tsx`) to interact with the agent orchestrator.
- **DAG Graph View**: Renders the `DagVisualizer` to inspect commits across all branches.
- **Diff & Merge View**: Renders the `DiffViewer` to perform branch comparisons and merge operations.

---

## 3. Interactive React Flow DAG Design

### 3.1 Data Retrieval (`/api/dag`)
React Flow needs a complete picture of all commits and branches to construct the node map. The `/api/dag` endpoint will retrieve this:
- **Endpoint**: `GET /api/dag`
- **Controller Logic**:
  ```typescript
  import { NextResponse } from "next/server";
  import { getBranches, getCommits } from "@/lib/db/db";

  export async function GET() {
    try {
      const [branches, commits] = await Promise.all([
        getBranches(),
        getCommits()
      ]);
      return NextResponse.json({ branches, commits });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }
  ```

### 3.2 Positional Layout Algorithm
To render the commit graph cleanly without external layout engines (like Dagre or D3-DAG which can introduces Next.js SSR/hydration issues), we propose a deterministic topological grid algorithm:

1. **Y-Axis Lane Assignment (Branches)**:
   - Perform a Depth-First Search (DFS) traversal of the branch hierarchy starting from the root branch `main`.
   - Each branch is assigned a unique vertical lane index (`0, 1, 2, ...`), ensuring child branches are placed adjacent to their parent branches.
   - `node.y = laneIndex * Y_SPACING` (e.g., `Y_SPACING = 140px`).

2. **X-Axis Generation Assignment (Commits)**:
   - For each commit, compute its "generation index" (horizontal offset).
   - Root commits (no parent) are at `generation = 0`.
   - For other commits: `generation = max(parentGenerations) + 1`. Since merge commits have multiple parents, we split `parentCommit` by comma and take the maximum.
   - `node.x = generation * X_SPACING` (e.g., `X_SPACING = 180px`).

#### Layout Computation Hook:
```typescript
interface PositionedCommitNode {
  id: string;
  x: number;
  y: number;
}

export function computeDagLayout(commits: Commit[], branches: Branch[]): Map<string, PositionedCommitNode> {
  // 1. Assign branch Y-lanes
  const branchLanes = new Map<string, number>();
  let laneCount = 0;
  
  const assignLane = (branchId: string) => {
    if (branchLanes.has(branchId)) return;
    branchLanes.set(branchId, laneCount++);
    
    // Process child branches
    const children = branches.filter(b => b.parentBranchId === branchId);
    for (const child of children) {
      assignLane(child.id);
    }
  };
  
  // Start lane assignment with main
  if (branches.some(b => b.id === "main")) {
    assignLane("main");
  }
  // Assign lanes for any orphaned branches
  for (const b of branches) {
    assignLane(b.id);
  }

  // 2. Assign commit X-generations
  const commitMap = new Map(commits.map(c => [c.id, c]));
  const generations = new Map<string, number>();

  const getGeneration = (commitId: string): number => {
    if (generations.has(commitId)) return generations.get(commitId)!;
    const commit = commitMap.get(commitId);
    if (!commit) return 0;

    if (!commit.parentCommit) {
      generations.set(commitId, 0);
      return 0;
    }

    const parentIds = commit.parentCommit.split(",").map(id => id.trim()).filter(Boolean);
    let maxGen = -1;
    for (const pId of parentIds) {
      maxGen = Math.max(maxGen, getGeneration(pId));
    }
    const gen = maxGen + 1;
    generations.set(commitId, gen);
    return gen;
  };

  const layout = new Map<string, PositionedCommitNode>();
  const X_SPACING = 180;
  const Y_SPACING = 140;

  for (const c of commits) {
    const lane = branchLanes.get(c.branchId) ?? 0;
    const gen = getGeneration(c.id);
    layout.set(c.id, {
      id: c.id,
      x: gen * X_SPACING,
      y: lane * Y_SPACING
    });
  }

  return layout;
}
```

### 3.3 Node and Edge Construction
- **Nodes**:
  - Custom type `commitNode`.
  - Data payload includes: commit message, facts array, retractions, timestamp, branchName, and whether it represents the current active branch head.
  - Nodes will be color-coded by branch type:
    - `main` branch: Emerald Green
    - `researcher` branches: Blue
    - `critic` branches: Rose Red
    - `builder` branches: Amber/Orange
- **Edges**:
  - Connect parent commit IDs to child commits.
  - For merge commits, two edges will converge into the node.
  - Edges will have closed arrowheads (`MarkerType.ArrowClosed`) pointing in the direction of lineage.
  - Edges representing forks or merges can use dashed lines or contrasting colors (e.g. indigo for merges) to differentiate from linear branch progression.

---

## 4. Side-by-Side Diff & Conflict Resolver Design

### 4.1 Data Retrieval (`/api/diff`)
A programmatic diff is required when comparing the active branch against a target, or when analyzing a merge proposal.
- **Endpoint**: `GET /api/diff?source=<sourceBranchId>&target=<targetBranchId>`
- **Controller Logic**:
  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  import { readDb } from "@/lib/db/db";
  import { recallFacts, diffFacts, detectConflicts } from "@/lib/memory/merge";

  export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get("source");
    const target = searchParams.get("target");

    if (!source || !target) {
      return NextResponse.json({ error: "Missing source or target" }, { status: 400 });
    }

    try {
      const db = await readDb();
      const factsSource = recallFacts(source, db);
      const factsTarget = recallFacts(target, db);

      const diff = diffFacts(factsTarget, factsSource);
      const conflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);

      return NextResponse.json({
        shared: diff.shared,
        uniqueTarget: diff.uniqueA, // facts in Target only (e.g. main)
        uniqueSource: diff.uniqueB, // facts in Source only (e.g. feature branch)
        conflicts
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }
  ```

### 4.2 Side-by-Side Diff Interface
We design a clean three-column responsive UI to display the diff:
1. **Target Branch Column (Left)**: Unique facts asserted on the target branch (e.g., `main`). Conflicting facts are highlighted in **red** with warning indicators.
2. **Source Branch Column (Right)**: Unique facts asserted on the incoming branch (e.g., `research-main-...`). Conflicting facts are highlighted in **red**.
3. **Shared Facts Column (Center or Accordion)**: Facts common to both branches, displayed with green checkmarks indicating consensus.

### 4.3 Interactive Conflict Panel & Resolution
When the diff API returns items in the `conflicts` array, the system shifts into **Merge Conflict Mode**:
- **Conflict Display Card**: Renders the pair of conflicting facts (`factA` and `factB`), the computed semantic reason (e.g., *"Mutually exclusive choice detected in category UI"*), and severity.
- **Resolution Options**:
  - **Option 1**: Keep Fact A (Target).
  - **Option 2**: Keep Fact B (Source).
  - **Option 3**: Keep both (if they can be adapted).
  - **Option 4: Custom Fact Resolution (Text Input)**: The user edits or writes a synthetic fact that resolves the contradiction (e.g. combining the two facts into a unified design constraint).
- **Submitting Resolutions**:
  Once resolutions are chosen or written for all conflict items, they are collected into a `resolvedFacts` array and posted to `/api/merge`.

### 4.4 Merge Execution API
- **Endpoint**: `POST /api/merge`
- **Payload**:
  ```json
  {
    "sourceBranchId": "research-main-1782392",
    "targetBranchId": "main",
    "resolvedFacts": [
      "Use PostgreSQL for transactional processing, syncing to ClickHouse for analytics"
    ]
  }
  ```
- **Controller Logic**:
  Calls `mergeBranches(sourceBranchId, targetBranchId, resolvedFacts)` which appends the merge commit with retractions and updates the branch.

---

## 5. Mockups & UX Flows

### 5.1 Chat Conflict Escape Hatch
When the orchestrator attempts to merge an agent sub-branch and encounters a conflict:
1. The SSE status stream emits an `error` event: `"Merge conflict detected between research-main and main"`.
2. The UI intercepts this error and renders a conflict callout card in the message thread:
   ```
   ┌────────────────────────────────────────────────────────┐
   │ ⚠️ Merge Conflict Detected                             │
   │ The incoming agent branch contains design assertions   │
   │ that contradict the main memory state.                 │
   │                                                        │
   │ [ Resolve Conflicts in Diff Viewer ]                   │
   └────────────────────────────────────────────────────────┘
   ```
3. Clicking the button opens the side-by-side `DiffViewer` page preloaded with the conflicting branches.

### 5.2 Conflict Resolution Card Sketch
```
┌────────────────────────────────────────────────────────────────────────┐
│ Conflict #1: mutually exclusive technology choice                       │
│ Reason: Mutually exclusive choice in category "db": Postgres vs Neo4j  │
├───────────────────────────────────┬────────────────────────────────────┤
│ Target Branch (main)              │ Incoming Branch                    │
│ [o] Use PostgreSQL for relational │ [ ] Use Neo4j for graph-based      │
│     data storage                  │     relationships                  │
├───────────────────────────────────┴────────────────────────────────────┤
│ [ ] Keep both statements                                               │
│ [ ] Write Custom Resolution:                                           │
│     [ Use PostgreSQL for relational metadata, and Neo4j for the ]      │
│     [ knowledge graph connections.                              ]      │
└────────────────────────────────────────────────────────────────────────┘
```

This completes the visual interface specifications. The design ensures high user feedback quality, zero structural overlap, and clean logical execution paths.
