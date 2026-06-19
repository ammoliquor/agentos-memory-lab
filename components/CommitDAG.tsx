"use client";

import React, { useMemo } from "react";
import ReactFlow, { Background, Controls, Node, Edge } from "reactflow";
import "reactflow/dist/style.css";
import { Commit, Branch } from "@/lib/types";
import CommitNode from "./CommitNode";

const BRANCH_COLORS = [
  "#3b82f6", // blue
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ef4444", // red
  "#06b6d4", // cyan
  "#84cc16", // lime
];

interface CommitDAGProps {
  branches: Branch[];
  commits: Commit[];
  selectedTargetId: string | null;
  selectedSourceId: string | null;
  onSelectTarget: (id: string | null) => void;
  onSelectSource: (id: string | null) => void;
  onInitiateMerge: () => void;
}

const nodeTypes = {
  commitNode: CommitNode,
};

export default function CommitDAG({
  branches,
  commits,
  selectedTargetId,
  selectedSourceId,
  onSelectTarget,
  onSelectSource,
  onInitiateMerge,
}: CommitDAGProps) {
  // 1. Sort branches so "main" is track 0
  const sortedBranches = useMemo(() => {
    const list = [...branches];
    const mainIdx = list.findIndex((b) => b.id === "main" || b.name === "main");
    if (mainIdx > -1) {
      const [mainBranch] = list.splice(mainIdx, 1);
      list.unshift(mainBranch);
    }
    return list;
  }, [branches]);

  const branchTrackMap = useMemo(() => {
    return new Map(sortedBranches.map((b, idx) => [b.id, idx]));
  }, [sortedBranches]);

  // 2. Sort commits globally by timestamp (ascending)
  const sortedCommits = useMemo(() => {
    return [...commits].sort((a, b) => a.timestamp - b.timestamp);
  }, [commits]);

  // 3. Map columns to max(parent_column) + 1 or global sequence
  const colMap = useMemo(() => {
    const cols = new Map<string, number>();
    sortedCommits.forEach((commit, globalIdx) => {
      let col = 0;
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(",");
        let maxParentCol = -1;
        for (const p of parents) {
          const parentId = p.trim();
          const parentCol = cols.get(parentId);
          if (parentCol !== undefined) {
            maxParentCol = Math.max(maxParentCol, parentCol);
          }
        }
        col = maxParentCol !== -1 ? maxParentCol + 1 : globalIdx;
      } else {
        col = globalIdx;
      }
      cols.set(commit.id, col);
    });
    return cols;
  }, [sortedCommits]);

  // Helper for branch color
  const getBranchColor = (branchId: string) => {
    const index = sortedBranches.findIndex(
      (b) => b.id === branchId || b.name === branchId
    );
    if (index === -1) return "#a1a1aa";
    return BRANCH_COLORS[index % BRANCH_COLORS.length];
  };

  // 4. Find branch HEADs
  const branchHeadsMap = useMemo(() => {
    const heads = new Map<string, Branch[]>();
    for (const branch of branches) {
      const branchCommits = commits.filter((c) => c.branchId === branch.id);
      if (branchCommits.length > 0) {
        branchCommits.sort((a, b) => b.timestamp - a.timestamp);
        const headCommitId = branchCommits[0].id;
        if (!heads.has(headCommitId)) {
          heads.set(headCommitId, []);
        }
        heads.get(headCommitId)!.push(branch);
      }
    }
    return heads;
  }, [branches, commits]);

  // 5. Build React Flow Nodes
  const nodes: Node[] = useMemo(() => {
    return sortedCommits.map((commit) => {
      const trackIdx = branchTrackMap.get(commit.branchId) ?? 0;
      const colIdx = colMap.get(commit.id) ?? 0;

      // Positioning coordinates mapping column -> X, track -> Y
      const x = colIdx * 160;
      const y = trackIdx * 120;

      return {
        id: commit.id,
        type: "commitNode",
        position: { x, y },
        data: {
          commit,
          isTarget: selectedTargetId === commit.id,
          isSource: selectedSourceId === commit.id,
          branchColor: getBranchColor(commit.branchId),
          branchHeads: branchHeadsMap.get(commit.id) || [],
        },
      };
    });
  }, [
    sortedCommits,
    branchTrackMap,
    colMap,
    selectedTargetId,
    selectedSourceId,
    branchHeadsMap,
    sortedBranches,
  ]);

  // 6. Build React Flow Edges
  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = [];
    commits.forEach((commit) => {
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(",");
        parents.forEach((p) => {
          const parentId = p.trim();
          if (parentId) {
            list.push({
              id: `e-${parentId}-${commit.id}`,
              source: parentId,
              target: commit.id,
              type: "smoothstep",
              animated: true,
              style: { stroke: "#3f3f46", strokeWidth: 2 },
            });
          }
        });
      }
    });
    return list;
  }, [commits]);

  const onNodeClick = (event: React.MouseEvent, node: Node) => {
    const commitId = node.id;
    if (selectedTargetId === commitId) {
      onSelectTarget(null);
    } else if (selectedSourceId === commitId) {
      onSelectSource(null);
    } else if (!selectedTargetId) {
      onSelectTarget(commitId);
    } else if (!selectedSourceId) {
      onSelectSource(commitId);
    } else {
      // Toggle/Replace source
      onSelectSource(commitId);
    }
  };

  const handleClear = () => {
    onSelectTarget(null);
    onSelectSource(null);
  };

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Selection Control Panel */}
      <div className="absolute top-4 left-4 z-10 bg-[#18181b]/90 backdrop-blur border border-[#27272a] p-3 rounded-lg flex flex-col gap-2 max-w-sm shadow-xl">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Selection Control
        </h3>
        <p className="text-[10px] text-zinc-500 leading-tight">
          Click nodes to select: First click sets Target (emerald), second sets Source (indigo). Click again to deselect.
        </p>

        <div className="flex flex-col gap-1.5 mt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Target (Merge to):</span>
            {selectedTargetId ? (
              <span className="font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800 font-semibold">
                {selectedTargetId.substring(0, 7)}
              </span>
            ) : (
              <span className="text-zinc-600 font-medium italic">None</span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Source (Merge from):</span>
            {selectedSourceId ? (
              <span className="font-mono px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-400 border border-indigo-800 font-semibold">
                {selectedSourceId.substring(0, 7)}
              </span>
            ) : (
              <span className="text-zinc-600 font-medium italic">None</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-2">
          {(selectedTargetId || selectedSourceId) && (
            <button
              onClick={handleClear}
              className="px-2.5 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
            >
              Clear
            </button>
          )}
          {selectedTargetId && selectedSourceId && (
            <button
              onClick={onInitiateMerge}
              className="flex-1 px-2.5 py-1 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
            >
              Compare & Diff
            </button>
          )}
        </div>
      </div>

      {/* React Flow Graph */}
      <div className="flex-1 w-full h-full bg-[#0c0c0e]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background color="#27272a" gap={20} size={1} />
          <Controls className="!bg-zinc-900 !border-zinc-700 !text-white [&>button]:!bg-zinc-900 [&>button]:!border-zinc-700 [&>button]:!fill-white [&>svg]:!fill-white" />
        </ReactFlow>
      </div>
    </div>
  );
}
