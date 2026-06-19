# Milestone 3 Design Report: React Flow DAG & Diff UI

This design report outlines the architecture and implementation details for Milestone 3: React Flow DAG & Diff UI. It includes component structures, data flow schemas, layout algorithms, API endpoint specifications, and conflict resolution flows.

---

## 1. Component Architecture

We propose introducing a modular component structure inside the `components` directory, with corresponding route pages under `app`.

```
app/
├── api/
│   ├── dag/
│   │   └── route.ts         # GET: returns branches and commits for DAG rendering
│   ├── diff/
│   │   └── route.ts         # GET: calculates diff & conflicts between branches/commits
│   └── merge/
│       └── route.ts         # POST: merges source branch into target branch (handles resolvedFacts)
└── dag/
    └── page.tsx             # The visual page container for DAG & Diff Workspace
```

### Proposed React Components
1. **`DAGWorkspace`** (`components/DAGWorkspace.tsx`):
   - The master wrapper component.
   - Manages state for:
     - `selectedSourceCommit` / `selectedSourceBranch`
     - `selectedTargetCommit` / `selectedTargetBranch`
     - Active view mode (DAG split-view vs. fullscreen)
     - Merge conflict state (whether a merge proposal is actively being resolved)
   - Coordinates visual state between the DAG view and the Diff panels.

2. **`CommitDAG`** (`components/CommitDAG.tsx`):
   - Integrates `reactflow` to render the interactive commit history graph.
   - Features custom node rendering (`CommitNode`) and custom edge paths.
   - Fits node coordinates dynamically using the custom grid positioning algorithm (see Section 3).
   - Allows double-clicking or button-triggered selections to mark nodes as "Source" (blue highlight) or "Target" (emerald highlight).

3. **`CommitNode`** (`components/CommitNode.tsx`):
   - Custom React Flow node.
   - Renders a clean visual circle representation of the commit.
   - Color-coded by branch type (e.g. `main` is indigo, research is yellow, critic is rose, builder is emerald).
   - Renders label badges for branch HEADs pointing to this commit (e.g. `[main]`, `[research-main-...]`).
   - Displays a tooltip on hover with the commit message, author/role, and timestamp.

4. **`DiffViewer`** (`components/DiffViewer.tsx`):
   - Side-by-side column view showing:
     - **Left Column**: Facts unique to Target branch/commit.
     - **Middle Column**: Shared facts.
     - **Right Column**: Facts unique to Source branch/commit.
   - Header displaying name/id of selected source & target.
   - Prominently lists **Conflicts** (contradictory facts detected via `lib/memory/merge.ts`) in an alert block.

5. **`ConflictResolver`** (`components/ConflictResolver.tsx`):
   - Active only when `POST /api/merge` fails with conflicts.
   - Lists each conflict side-by-side (Fact A vs. Fact B).
   - Provides options for each conflict:
     - "Keep target fact (A)"
     - "Keep source fact (B)"
     - "Synthesize customized resolution" (renders a text area initialized with a merged draft).
   - Submits the finalized array of `resolvedFacts` to complete the merge.

---

## 2. API Design & Data Fetching

### 2.1 `GET /api/dag`
Fetches the full commit and branch state.
- **Backend call**: `getBranches()` and `getCommits()` from `lib/db/db.ts`.
- **Response Format**:
  ```json
  {
    "branches": [
      { "id": "main", "name": "main", "parentBranchId": null },
      { "id": "research-main-123", "name": "research-main-123", "parentBranchId": "main", "forkCommitId": "c_1" }
    ],
    "commits": [
      {
        "id": "c_1",
        "branchId": "main",
        "message": "Initial",
        "facts": ["Fact A"],
        "parentCommit": null,
        "timestamp": 1718000000000
      }
    ]
  }
  ```

### 2.2 `GET /api/diff`
Computes the diff and conflicts between two pointers (branches or individual commits).
- **Parameters**: `source` (branchId or commitId), `target` (branchId or commitId).
- **Logic**:
  1. Retrieve facts at both pointers:
     - If the parameter matches a branch ID in the database, fetch its active facts using `recallFacts(branchId, db)`.
     - If it is a commit ID, compute the active facts by traversing ancestors of the commit and applying retractions (similar to `recallFacts` but starting from a specific commit).
  2. Compute diff using `diffFacts(factsTarget, factsSource)`.
  3. Detect conflicts using `detectConflicts(diff.uniqueA, diff.uniqueB)`.
- **Response Format**:
  ```json
  {
    "shared": ["Fact A"],
    "uniqueTarget": ["Fact B"],
    "uniqueSource": ["Fact C"],
    "conflicts": [
      {
        "factA": "Fact B",
        "factB": "Fact C",
        "reason": "Direct logical negation.",
        "severity": "HIGH"
      }
    ]
  }
  ```

### 2.3 `POST /api/merge`
Attempts to merge a source branch into a target branch.
- **Request Body**:
  ```json
  {
    "sourceBranchId": "research-main-123",
    "targetBranchId": "main",
    "resolvedFacts": ["Fact B and Fact C unified version"] 
  }
  ```
- **Logic**:
  - Calls `mergeBranches(sourceBranchId, targetBranchId, resolvedFacts)` from `lib/memory/merge.ts`.
  - If a merge conflict is detected and `resolvedFacts` is empty, `mergeBranches` will automatically write a conflict proposal and throw an error. The API catches this error and returns a `409 Conflict` status code along with the proposal details.
  - If successful, it returns the generated merge commit.
- **Response Format (Success)**:
  ```json
  {
    "success": true,
    "commit": {
      "id": "c_merge_123",
      "branchId": "main",
      "message": "Merge branch 'research-main-123' into 'main'",
      "facts": ["Fact B and Fact C unified version"],
      "parentCommit": "c_target_head,c_source_head",
      "timestamp": 1718000500000
    }
  }
  ```
- **Response Format (Conflict)**:
  ```json
  {
    "success": false,
    "error": "Merge conflict detected",
    "conflicts": [
      {
        "factA": "Use Postgres",
        "factB": "Use Neo4j",
        "reason": "Mutually exclusive database choice",
        "severity": "HIGH"
      }
    ]
  }
  ```

---

## 3. React Flow DAG Generation & Positioning Algorithm

### 3.1 Node & Edge Construction
- **Nodes**:
  - We loop through the list of `commits`.
  - If a commit is the HEAD of a branch (i.e. its timestamp is the newest for that `branchId`), we attach the branch metadata to the node data.
- **Edges**:
  - Loop through commits. For each commit, inspect its `parentCommit` field:
    - If `parentCommit` is `null`, skip.
    - If `parentCommit` contains a comma (e.g. `parentA,parentB` indicating a merge commit), split by comma and create two distinct edges:
      1. Edge: `parentA` -> `currentCommit.id` (styled as main target path).
      2. Edge: `parentB` -> `currentCommit.id` (styled as source merge path, colored in purple with dashed lines).
    - If `parentCommit` is a single commit, create one edge: `parentCommit` -> `currentCommit.id`.

### 3.2 Positioning Algorithm (Horizontal Layout)
We propose a robust **Lanes & Chronological Columns** positioning algorithm to prevent node overlaps and maintain chronological timeline ordering.

```
       (Col 0)      (Col 1)      (Col 2)      (Col 3)
         c_1 ──────── c_2 ────────────────────── c_5 (Merge Commit)
main      │                         ▲             ▲
──────────┼─────────────────────────┼─────────────┼────────── (Lane 0: y=0)
          │                         │             │
research  └─── c_3 (Fork) ──────────┘             │
──────────┼───────────────────────────────────────┼────────── (Lane 1: y=120)
          │                                       │
critic    └─── c_4 (Fork) ────────────────────────┘
───────────────────────────────────────────────────────────── (Lane 2: y=240)
```

#### Algorithm Steps:
1. **Assign Y Coordinates (Branch Lanes)**:
   - Identify all unique branch IDs.
   - Map `main` to track `0`.
   - Iterate through other branches. If they are child branches, assign them track indexes in order of creation or relationship:
     - `branchTrackMap[branchId] = trackIndex * 120` (providing 120px vertical spacing).
   - A commit's Y coordinate is `y = branchTrackMap[commit.branchId]`.

2. **Assign X Coordinates (Topological/Chronological Columns)**:
   - Sort all commits globally by their `timestamp`.
   - Maintain a column counter `currentCol = 0` and a map of `commitColMap[commitId] -> columnIndex`.
   - Assign column indices:
     - For each commit in the sorted list:
       - If it has parent commits:
         - The column is `max(commitColMap[parent_i]) + 1`.
       - If it has no parents, it defaults to column `0` (or parent branch's fork point column + 1).
       - Ensure `x` coordinates are incremented properly: `x = columnIndex * 160`.
   - This ensures that:
     - Children always appear to the right of their parents.
     - Multiple parallel branches keep their relative chronological order without overlap.
     - Fast-forward sequences align vertically and horizontally.

---

## 4. Side-by-Side Diff & Conflict Viewer UI

The `DiffViewer` visualizes state using a clean, accessible layout:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Target vs. Source Diff                          │
├───────────────────────┬────────────────────────┬───────────────────────┤
│ Target (Branch: main) │ Shared Facts           │ Source (Branch: res)  │
├───────────────────────┼────────────────────────┼───────────────────────┤
│ * Postgres for OLTP   │ * Tailwind CSS for UI  │ * ClickHouse for logs │
│                       │ * Node.js backend      │                       │
└───────────────────────┴────────────────────────┴───────────────────────┘
```

### Layout Sections:
1. **Header**:
   - Displays clear identifiers for the selected nodes/branches.
   - Displays a "Merge" action button if the target is writeable.

2. **Semantic Conflicts Alert Panel**:
   - Visible if there are active conflicts.
   - Colored in a warning theme (crimson border, dark red background).
   - Lists contradictions with reasons.

3. **Three-Column Grid**:
   - **Target-Unique (Left)**: Bulleted list of facts only in Target.
   - **Shared (Center)**: Bulleted list of facts present in both (grey text).
   - **Source-Unique (Right)**: Bulleted list of facts only in Source.

---

## 5. Conflict Resolution Workflow

When a merge operation fails due to semantic contradictions, the UI transitions to a resolution state:

1. **Detection**:
   - The user clicks "Merge".
   - The React client POSTs to `/api/merge`.
   - The server catches a conflict error thrown by `mergeBranches()` and returns `409 Conflict` with the conflicts array.

2. **Interactivity**:
   - The `ConflictResolver` component replaces or overlays the main view.
   - For each conflict, the user is presented with resolution options:
     - **Option A**: Accept Target Fact (`factA`).
     - **Option B**: Accept Source Fact (`factB`).
     - **Option C**: Accept Both (adds both to the final facts list).
     - **Option D**: Custom synthesis (editable text input initialized with both facts concatenated).
   - Selecting options updates a local `resolvedFacts` array state.

3. **Execution**:
   - The user clicks "Confirm Resolution".
   - The client POSTs to `/api/merge` with `resolvedFacts`.
   - The server processes the merge, creates the merge commit, and marks the proposal as `RESOLVED`.
   - The DAG is re-fetched and re-rendered, showing the new merge commit connecting the source branch to the target branch.
