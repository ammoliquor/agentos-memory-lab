# Architectural Design & Proposal: React Flow DAG & Diff UI (Milestone 3)

## 1. Executive Summary
This design proposal outlines the frontend architecture and database integrations required to build the visual interfaces for Milestone 3:
1. **Interactive React Flow DAG Visualization**: A graphical representation of the commit history, demonstrating branch forks and merge paths.
2. **Side-by-Side Diff & Conflict Resolver**: A clean interface showing shared facts, unique facts, and semantic conflicts, allowing developers/agents to resolve conflicts and execute branch merges.

All designs are optimized for the existing Next.js 15 (App Router), React 19, Tailwind CSS, and shadcn/ui framework stack.

---

## 2. Layout & Workspace Architecture

To preserve the existing multi-agent chat interface while integrating the DAG Visualizer and Diff UI, we propose a **tabbed workspace area** inside the active branch page (`app/branch/[branchId]/page.tsx`).

### Component Tree
```
Layout (app/layout.tsx)
 └── BranchPage (app/branch/[branchId]/page.tsx) [RSC]
      ├── Sidebar (components/Sidebar.tsx)
      └── BranchWorkspace (components/BranchWorkspace.tsx) [Client]
           ├── ActiveBranchHeader (components/ActiveBranchHeader.tsx)
           ├── WorkspaceTabs (Navigation Buttons: Chat | DAG | Diff)
           └── Tab Content:
                ├── ChatContainer (components/ChatContainer.tsx)
                ├── DagVisualizer (components/DagVisualizer.tsx)
                └── DiffViewer (components/DiffViewer.tsx)
```

### Component: `BranchWorkspace`
This client component manages the active tab state (`'chat' | 'dag' | 'diff'`) and client-side data updates.

```tsx
"use client";

import { useState } from "react";
import { Branch, Message } from "@/lib/types";
import ActiveBranchHeader from "./ActiveBranchHeader";
import ChatContainer from "./ChatContainer";
import DagVisualizer from "./DagVisualizer";
import DiffViewer from "./DiffViewer";
import { MessageSquare, GitFork, Diff } from "lucide-react";

interface BranchWorkspaceProps {
  branch: Branch;
  branches: Branch[];
  initialMessages: Message[];
}

export default function BranchWorkspace({ branch, branches, initialMessages }: BranchWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "dag" | "diff">("chat");

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#09090b]">
      {/* Active Branch Header */}
      <ActiveBranchHeader branch={branch} />

      {/* Tab Switcher */}
      <div className="border-b border-[#27272a] bg-[#18181b]/10 px-6 py-2 flex items-center space-x-2">
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeTab === "chat"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat Context</span>
        </button>
        <button
          onClick={() => setActiveTab("dag")}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeTab === "dag"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <GitFork className="w-3.5 h-3.5" />
          <span>DAG Visualizer</span>
        </button>
        <button
          onClick={() => setActiveTab("diff")}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeTab === "diff"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Diff className="w-3.5 h-3.5" />
          <span>Diff & Merge</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === "chat" && (
          <ChatContainer branchId={branch.id} initialMessages={initialMessages} />
        )}
        {activeTab === "dag" && (
          <DagVisualizer activeBranchId={branch.id} />
        )}
        {activeTab === "diff" && (
          <DiffViewer targetBranchId={branch.id} branches={branches} />
        )}
      </div>
    </div>
  );
}
```

---

## 3. Interactive React Flow DAG Engine

The commit DAG is visual, representing how branches diverge and merge over time. We will use the `reactflow` library (already installed, v11.10.1).

### Layout & Spacing Requirements
- **Horizontal Flow (Left-to-Right)**: History flows naturally from left to right.
- **Node Spacing**:
  - `X_SPACING` = `240` (Horizontal space between topological levels).
  - `Y_SPACING` = `120` (Vertical space between branch lanes).

### Core Deterministic Positioning Algorithms

To avoid layout overlapping and external heavy graph layout engines (like dagre/g6) which might cause client-side bundling or layout shift issues, we will compute positions deterministically using two key metrics:
1. **Topological Depth (x-coordinate)**: Calculated based on parent-child commit lineage.
2. **Branch Lanes (y-coordinate)**: Assigned to branches to stack parent and child branches vertically.

#### 1. Topological Depth (x-axis)
Each commit node is assigned a depth. The root commit starts at depth `0`. Any child commit has a depth of `max(parentCommitDepths) + 1`. This aligns all parallel commits cleanly.

```typescript
export interface Commit {
  id: string;
  branchId: string;
  message: string;
  facts: string[];
  parentCommit: string | null; // Comma-separated parent commit IDs
  timestamp: number;
}

export function calculateCommitDepths(commits: Commit[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const commitMap = new Map<string, Commit>();
  for (const c of commits) {
    commitMap.set(c.id, c);
  }

  function getDepth(commitId: string): number {
    if (depthMap.has(commitId)) {
      return depthMap.get(commitId)!;
    }

    const commit = commitMap.get(commitId);
    if (!commit) return 0; // Fallback for missing/corrupt references

    if (!commit.parentCommit) {
      depthMap.set(commitId, 0);
      return 0;
    }

    // Handles split parents in case of merges (e.g. "c_parent1,c_parent2")
    const parents = commit.parentCommit.split(",").map(p => p.trim()).filter(Boolean);
    let maxParentDepth = -1;
    for (const parentId of parents) {
      const parentDepth = getDepth(parentId);
      if (parentDepth > maxParentDepth) {
        maxParentDepth = parentDepth;
      }
    }

    const depth = maxParentDepth + 1;
    depthMap.set(commitId, depth);
    return depth;
  }

  for (const c of commits) {
    getDepth(c.id);
  }

  return depthMap;
}
```

#### 2. Branch Lanes Assignment (y-axis)
Branches are assigned vertical lane offsets. The `main` branch sits at lane `0`. Child branches are assigned lanes alternating above and below their parents.

```typescript
export interface Branch {
  id: string;
  name: string;
  parentBranchId: string | null;
  forkCommitId?: string | null;
}

export function assignBranchLanes(branches: Branch[]): Map<string, number> {
  const laneMap = new Map<string, number>();
  laneMap.set("main", 0);

  // Group children of each branch
  const childrenMap = new Map<string, string[]>();
  for (const b of branches) {
    if (b.parentBranchId) {
      const list = childrenMap.get(b.parentBranchId) || [];
      list.push(b.id);
      childrenMap.set(b.parentBranchId, list);
    }
  }

  let nextPositiveLane = 1;
  let nextNegativeLane = -1;

  function traverse(branchId: string, parentLane: number) {
    const children = childrenMap.get(branchId) || [];
    children.forEach((childId, index) => {
      let assignedLane: number;
      if (index % 2 === 0) {
        assignedLane = parentLane + nextPositiveLane;
        nextPositiveLane++;
      } else {
        assignedLane = parentLane + nextNegativeLane;
        nextNegativeLane--;
      }
      laneMap.set(childId, assignedLane);
      traverse(childId, assignedLane);
    });
  }

  traverse("main", 0);

  // Robustness fallback for unmapped or orphan branches
  let fallbackLane = Math.max(nextPositiveLane, Math.abs(nextNegativeLane)) + 1;
  for (const b of branches) {
    if (!laneMap.has(b.id)) {
      laneMap.set(b.id, fallbackLane);
      fallbackLane++;
    }
  }

  return laneMap;
}
```

### React Flow Nodes and Edges Generation
To construct the graph layout:
- **Nodes**: A map processes each commit. The position is `{ x: depth * 240, y: lane * 120 }`.
- **Edges**: We parse `commit.parentCommit`. If it is present, we create source-target edges.
- **Fork Edges**: If a commit is the first commit of a child branch (no `parentCommit`), we check if the branch has a `forkCommitId`. If yes, we draw an edge from `forkCommitId` to this first commit to link the branch fork visually.

### Custom React Flow Node: `CommitNode`
Provides a clean card UI representing the commit.

```tsx
import { Handle, Position } from "reactflow";
import { Commit } from "@/lib/types";
import { Calendar, Tag } from "lucide-react";

interface CommitNodeProps {
  data: {
    commit: Commit;
    branchName: string;
    isActiveHead: boolean;
    onSelect: (commit: Commit) => void;
  };
}

export function CommitNode({ data }: CommitNodeProps) {
  const { commit, branchName, isActiveHead, onSelect } = data;
  const shortId = commit.id.substring(0, 8);

  return (
    <div
      onClick={() => onSelect(commit)}
      className={`w-52 bg-[#18181b] border rounded-lg p-3 text-left transition-all cursor-pointer hover:border-indigo-500 shadow-md ${
        isActiveHead ? "border-emerald-500 ring-2 ring-emerald-950" : "border-[#27272a]"
      }`}
    >
      {/* Handles for Horizontal Connection */}
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-indigo-500" />
      
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] font-semibold text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-[#27272a]">
          {shortId}
        </span>
        <span className="flex items-center text-[10px] text-zinc-500 space-x-1">
          <Calendar className="w-3 h-3" />
          <span>{new Date(commit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      </div>

      <div className="text-xs font-medium text-white truncate mb-2" title={commit.message}>
        {commit.message}
      </div>

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center space-x-1 text-[9px] font-semibold text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded-full border border-indigo-900/30 max-w-[70%] truncate">
          <Tag className="w-2.5 h-2.5 flex-shrink-0" />
          <span className="truncate">{branchName}</span>
        </span>
        {commit.facts && (
          <span className="text-[10px] text-zinc-500 font-mono">
            {commit.facts.length} facts
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-indigo-500" />
    </div>
  );
}
```

### Commit Details Sidebar Panel
When a user clicks on a `CommitNode`, the `onSelect` callback triggers, displaying a sidebar panel (or drawer) next to the DAG canvas showing:
- Commit ID and Branch Context
- Commit Message and Date
- **Facts Asserted**: List of facts committed.
- **Facts Retracted**: Optional list of retractions (`commit.retractions`).
- **Ancestry Path**: Parent commit links.

---

## 4. Side-by-Side Diff & Conflict Resolver

The Diff UI is a core tool for managing multi-agent state. It allows contrasting the current (Target) branch's facts with another (Source) branch, displaying semantic contradictions and resolving conflicts.

### Layout Layout Grid: Side-by-Side Columns
We display two main panels for branch comparison, a top warning banner for semantic conflicts, and a resolution builder.

```
+-----------------------------------------------------------+
| Select Source Branch: [feature-beta v]                    |
+-----------------------------------------------------------+
| [!] Conflict Detected: postgres vs neo4j (High Severity)  |
|     [Keep postgres] [Keep neo4j] [Discard Both]           |
+-----------------------------------------------------------+
| TARGET BRANCH (Active)    | SOURCE BRANCH (Selected)      |
| facts unique to target    | facts unique to source        |
| - Fact A1                 | - Fact B1                     |
| - Fact A2                 | - Fact B2                     |
+-----------------------------------------------------------+
| SHARED CONSENSUS FACTS                                    |
| - Shared Fact 1                                           |
| - Shared Fact 2                                           |
+-----------------------------------------------------------+
```

### Resolving Semantic Conflicts
When conflicts exist, the UI allows selection of which facts to keep.
- **Keep Target (`factA`)**: Retains active branch selection.
- **Keep Source (`factB`)**: Discards Target's assertion, keeps Source's.
- **Keep Both / Discard**: Allows custom selection.
The application collects all resolved facts into an array.
Once resolution is complete, the user can click **"Execute Merge"**, which invokes the API to merge branches, executing the action and committing a new merge node onto the graph.

---

## 5. Next.js API Endpoints

To support these dynamic components on the client-side, we must expose three clean database reading/writing endpoints inside Next.js.

### 1. GET `/api/dag`
Fetches all DAG structural data: commits and branches.
File path: `app/api/dag/route.ts`

```typescript
import { NextResponse } from "next/server";
import { readDb } from "@/lib/db/db";

export async function GET() {
  try {
    const db = await readDb();
    return NextResponse.json({
      branches: db.branches,
      commits: db.commits
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch DAG data" }, { status: 500 });
  }
}
```

### 2. GET `/api/diff`
Fetches diff calculations (shared, unique target, unique source) and conflicts.
File path: `app/api/diff/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readDb } from "@/lib/db/db";
import { diffFacts, detectConflicts, recallFacts } from "@/lib/memory/merge";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("target");
    const source = searchParams.get("source");

    if (!target || !source) {
      return NextResponse.json({ error: "Missing target or source branch ID" }, { status: 400 });
    }

    const db = await readDb();
    const targetBranch = db.branches.find(b => b.id === target || b.name === target);
    const sourceBranch = db.branches.find(b => b.id === source || b.name === source);

    if (!targetBranch) {
      return NextResponse.json({ error: `Target branch '${target}' not found` }, { status: 404 });
    }
    if (!sourceBranch) {
      return NextResponse.json({ error: `Source branch '${source}' not found` }, { status: 404 });
    }

    // Retrieve active accumulated states
    const factsTarget = recallFacts(targetBranch.id, db);
    const factsSource = recallFacts(sourceBranch.id, db);

    // Compute diff and semantic contradictions
    const diff = diffFacts(factsTarget, factsSource);
    const conflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);

    return NextResponse.json({
      targetBranchId: targetBranch.id,
      sourceBranchId: sourceBranch.id,
      shared: diff.shared,
      uniqueTarget: diff.uniqueA,
      uniqueSource: diff.uniqueB,
      conflicts
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Diff calculation failed" }, { status: 500 });
  }
}
```

### 3. POST `/api/merge`
Triggers branch merge commit execution with selected resolutions.
File path: `app/api/merge/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { mergeBranches } from "@/lib/memory/merge";

export async function POST(req: NextRequest) {
  try {
    const { sourceBranchId, targetBranchId, resolvedFacts } = await req.json();

    if (!sourceBranchId || !targetBranchId) {
      return NextResponse.json({ error: "Missing sourceBranchId or targetBranchId" }, { status: 400 });
    }

    // Run transaction via mergeBranches wrapper
    const mergeCommit = await mergeBranches(sourceBranchId, targetBranchId, resolvedFacts || []);
    
    return NextResponse.json({
      message: `Merged branch '${sourceBranchId}' into '${targetBranchId}' successfully.`,
      commit: mergeCommit
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Branch merge failed" }, { status: 500 });
  }
}
```

---

## 6. Frontend Components Detailed Implementation

### Component: `DiffViewer` (Selected Code Block)
Exposes the comparison panels and interactive merge triggers.

```tsx
"use client";

import { useState, useEffect } from "react";
import { Branch, Conflict } from "@/lib/types";
import { AlertCircle, ArrowLeftRight, Check, X, ShieldAlert } from "lucide-react";

interface DiffViewerProps {
  targetBranchId: string;
  branches: Branch[];
}

interface DiffData {
  shared: string[];
  uniqueTarget: string[];
  uniqueSource: string[];
  conflicts: Conflict[];
}

export default function DiffViewer({ targetBranchId, branches }: DiffViewerProps) {
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Resolution choices: map of "factA||factB" to selected fact
  const [resolutions, setResolutions] = useState<Map<string, string>>(new Map());
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState("");

  const otherBranches = branches.filter((b) => b.id !== targetBranchId);

  useEffect(() => {
    if (!sourceBranchId) {
      setDiffData(null);
      return;
    }

    const fetchDiff = async () => {
      setLoading(true);
      setError("");
      setMergeResult("");
      setResolutions(new Map());
      try {
        const res = await fetch(`/api/diff?target=${targetBranchId}&source=${sourceBranchId}`);
        if (!res.ok) throw new Error("Failed to calculate diff");
        const data = await res.json();
        setDiffData(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [sourceBranchId, targetBranchId]);

  const handleResolveConflict = (factA: string, factB: string, chosenFact: string) => {
    const key = [factA, factB].sort().join("||");
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(key, chosenFact);
      return next;
    });
  };

  const handleExecuteMerge = async () => {
    if (!diffData || !sourceBranchId) return;

    // Verify all conflicts are resolved
    if (resolutions.size < diffData.conflicts.length) {
      setError("Please resolve all conflicts before merging.");
      return;
    }

    setMerging(true);
    setError("");
    
    // Collect all facts we want to keep
    const resolvedFacts: string[] = [];
    
    // 1. Add non-conflicting facts from both sides
    const conflictingA = new Set(diffData.conflicts.map(c => c.factA));
    const conflictingB = new Set(diffData.conflicts.map(c => c.factB));
    
    diffData.uniqueTarget.forEach(f => { if (!conflictingA.has(f)) resolvedFacts.push(f); });
    diffData.uniqueSource.forEach(f => { if (!conflictingB.has(f)) resolvedFacts.push(f); });
    
    // 2. Add user-selected resolutions
    resolutions.forEach(val => {
      if (val && !resolvedFacts.includes(val)) {
        resolvedFacts.push(val);
      }
    });

    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceBranchId,
          targetBranchId,
          resolvedFacts
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      
      setMergeResult("Branches successfully merged! A merge commit has been created.");
      setDiffData(null);
      setSourceBranchId("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 text-white bg-[#09090b]">
      {/* Branch Selector Dropdown */}
      <div className="flex items-center space-x-3 bg-zinc-900 border border-[#27272a] p-4 rounded-lg max-w-lg">
        <ArrowLeftRight className="w-5 h-5 text-indigo-400" />
        <div className="flex-1">
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">
            Compare with Source Branch
          </label>
          <select
            value={sourceBranchId}
            onChange={(e) => setSourceBranchId(e.target.value)}
            className="w-full bg-zinc-950 border border-[#27272a] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">-- Choose a branch --</option>
            {otherBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/20 border border-red-900/40 p-4 rounded-lg flex items-start space-x-2.5 text-xs text-red-400 max-w-4xl">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {mergeResult && (
        <div className="bg-emerald-950/20 border border-emerald-900/40 p-4 rounded-lg flex items-start space-x-2.5 text-xs text-emerald-400 max-w-4xl">
          <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{mergeResult}</span>
        </div>
      )}

      {loading && (
        <div className="text-zinc-500 text-xs flex items-center space-x-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
          <span>Loading diff metrics...</span>
        </div>
      )}

      {diffData && (
        <div className="space-y-6 max-w-6xl">
          {/* Conflicts Panel */}
          {diffData.conflicts.length > 0 && (
            <div className="border border-red-900/40 bg-red-950/5 rounded-lg overflow-hidden">
              <div className="bg-red-950/30 px-4 py-2.5 border-b border-red-900/40 flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                <span className="text-xs font-semibold text-red-400">
                  Semantic Conflict Resolution Required ({diffData.conflicts.length} conflict{diffData.conflicts.length > 1 ? "s" : ""})
                </span>
              </div>
              <div className="p-4 divide-y divide-red-950/50 space-y-3">
                {diffData.conflicts.map((conflict, index) => {
                  const key = [conflict.factA, conflict.factB].sort().join("||");
                  const choice = resolutions.get(key);
                  return (
                    <div key={index} className="pt-3 first:pt-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-[10px] text-red-400 bg-red-950/30 px-2 py-0.5 rounded border border-red-900/20 inline-block font-mono">
                          Reason: {conflict.reason}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="text-zinc-300 border-l-2 border-indigo-500 pl-2">
                            <span className="text-[10px] text-indigo-400 font-semibold block uppercase">Target Branch Fact</span>
                            {conflict.factA}
                          </div>
                          <div className="text-zinc-300 border-l-2 border-amber-500 pl-2">
                            <span className="text-[10px] text-amber-400 font-semibold block uppercase">Source Branch Fact</span>
                            {conflict.factB}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 flex-shrink-0 self-start md:self-center">
                        <button
                          onClick={() => handleResolveConflict(conflict.factA, conflict.factB, conflict.factA)}
                          className={`px-2 py-1 text-[10px] rounded font-semibold border transition-all ${
                            choice === conflict.factA
                              ? "bg-indigo-600 border-indigo-500 text-white"
                              : "border-[#27272a] bg-zinc-900 text-zinc-400 hover:text-white"
                          }`}
                        >
                          Keep Target
                        </button>
                        <button
                          onClick={() => handleResolveConflict(conflict.factA, conflict.factB, conflict.factB)}
                          className={`px-2 py-1 text-[10px] rounded font-semibold border transition-all ${
                            choice === conflict.factB
                              ? "bg-amber-600 border-amber-500 text-white"
                              : "border-[#27272a] bg-zinc-900 text-zinc-400 hover:text-white"
                          }`}
                        >
                          Keep Source
                        </button>
                        <button
                          onClick={() => handleResolveConflict(conflict.factA, conflict.factB, "")}
                          className={`px-2 py-1 text-[10px] rounded font-semibold border transition-all ${
                            choice === ""
                              ? "bg-zinc-800 border-zinc-700 text-white"
                              : "border-[#27272a] bg-zinc-900 text-zinc-400 hover:text-white"
                          }`}
                        >
                          Discard Both
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Side-by-Side Fact Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Target Facts */}
            <div className="border border-[#27272a] bg-[#18181b]/30 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wider flex items-center justify-between">
                <span>Unique to Target ({targetBranchId})</span>
                <span className="text-[10px] bg-zinc-800 text-zinc-300 font-mono px-2 py-0.5 rounded">
                  {diffData.uniqueTarget.length} facts
                </span>
              </h3>
              {diffData.uniqueTarget.length === 0 ? (
                <div className="text-xs text-zinc-600 italic">No unique target facts.</div>
              ) : (
                <ul className="space-y-2">
                  {diffData.uniqueTarget.map((fact, i) => (
                    <li key={i} className="text-xs text-zinc-300 border-l border-zinc-700 pl-2.5 py-0.5">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Source Facts */}
            <div className="border border-[#27272a] bg-[#18181b]/30 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wider flex items-center justify-between">
                <span>Unique to Source ({sourceBranchId})</span>
                <span className="text-[10px] bg-zinc-800 text-zinc-300 font-mono px-2 py-0.5 rounded">
                  {diffData.uniqueSource.length} facts
                </span>
              </h3>
              {diffData.uniqueSource.length === 0 ? (
                <div className="text-xs text-zinc-600 italic">No unique source facts.</div>
              ) : (
                <ul className="space-y-2">
                  {diffData.uniqueSource.map((fact, i) => (
                    <li key={i} className="text-xs text-zinc-300 border-l border-zinc-700 pl-2.5 py-0.5">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Unified Merge Trigger */}
          <div className="flex items-center justify-between bg-zinc-950 border border-[#27272a] p-4 rounded-lg">
            <span className="text-xs text-zinc-400">
              {diffData.conflicts.length > 0 && resolutions.size < diffData.conflicts.length
                ? "Resolve conflicts to activate branch merging."
                : "All conflicts resolved. Ready to merge."}
            </span>
            <button
              onClick={handleExecuteMerge}
              disabled={merging || (diffData.conflicts.length > 0 && resolutions.size < diffData.conflicts.length)}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {merging ? "Merging Branches..." : `Merge ${sourceBranchId} into ${targetBranchId}`}
            </button>
          </div>

          {/* Shared Facts (Consensus) */}
          <div className="border border-[#27272a] bg-[#18181b]/10 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wider flex items-center justify-between">
              <span>Shared Facts in Common</span>
              <span className="text-[10px] bg-zinc-800 text-zinc-300 font-mono px-2 py-0.5 rounded">
                {diffData.shared.length} shared
              </span>
            </h3>
            {diffData.shared.length === 0 ? (
              <div className="text-xs text-zinc-600 italic">No shared facts.</div>
            ) : (
              <ul className="space-y-1.5 opacity-60">
                {diffData.shared.map((fact, i) => (
                  <li key={i} className="text-xs text-zinc-400 list-disc list-inside">
                    {fact}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 7. Verification and Testing Strategy

### 1. API Route Coverage Verification
Write standard tests using the project's test suite to assert api response values:
- Requesting `/api/dag` yields valid JSON with `branches` and `commits` arrays.
- Querying `/api/diff?target=main&source=feature-alpha` checks status codes and matches schema outputs.
- Submitting resolutions to `/api/merge` returns the transaction commit.

### 2. Edge Case & Fault-Tolerance Checking
- **Missing references**: The positioning code handles unlinked branches or corrupt parent references without throwing runtime application errors.
- **Empty Facts**: If there are no facts returned, the UI renders appropriate placeholder items ("No unique facts").
- **Resolution updates**: Toggle select choices updating the internal map triggers correct state changes prior to merge initiation.
