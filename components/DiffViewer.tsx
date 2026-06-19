"use client";

import React, { useMemo, useState } from "react";
import { Branch, Commit, Conflict } from "@/lib/types";
import { AlertTriangle, GitMerge, Settings } from "lucide-react";

interface DiffViewerProps {
  target: string;
  source: string;
  branches: Branch[];
  commits: Commit[];
  diffData: {
    shared: string[];
    uniqueTarget: string[];
    uniqueSource: string[];
    conflicts: Conflict[];
  };
  onMergeSuccess: () => void;
  onStartResolution: () => void;
}

export default function DiffViewer({
  target,
  source,
  branches,
  commits,
  diffData,
  onMergeSuccess,
  onStartResolution,
}: DiffViewerProps) {
  const [isMerging, setIsMerging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resolve target & source node IDs to branches (if they correspond to branches/HEADs)
  const targetBranch = useMemo(() => {
    return (
      branches.find((b) => b.id === target || b.name === target) ||
      branches.find((b) => {
        const bCommits = commits.filter((c) => c.branchId === b.id);
        if (bCommits.length === 0) return false;
        bCommits.sort((a, b) => b.timestamp - a.timestamp);
        return bCommits[0].id === target;
      })
    );
  }, [target, branches, commits]);

  const sourceBranch = useMemo(() => {
    return (
      branches.find((b) => b.id === source || b.name === source) ||
      branches.find((b) => {
        const bCommits = commits.filter((c) => c.branchId === b.id);
        if (bCommits.length === 0) return false;
        bCommits.sort((a, b) => b.timestamp - a.timestamp);
        return bCommits[0].id === source;
      })
    );
  }, [source, branches, commits]);

  const isTargetWriteable = !!targetBranch;
  const canMerge = isTargetWriteable && !!sourceBranch && targetBranch.id !== sourceBranch.id;

  const handleDirectMerge = async () => {
    if (!canMerge || !targetBranch || !sourceBranch) return;
    setIsMerging(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceBranchId: sourceBranch.id,
          targetBranchId: targetBranch.id,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to merge branches");
      }

      onMergeSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during merge");
    } finally {
      setIsMerging(false);
    }
  };

  const getRefLabel = (ref: string, branch?: Branch) => {
    if (branch) return `Branch: ${branch.name}`;
    return `Commit: ${ref.substring(0, 7)}`;
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] border-t lg:border-t-0 lg:border-l border-[#27272a] text-white">
      {/* Header */}
      <div className="p-4 border-b border-[#27272a] bg-[#18181b] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-400">
            Diff Viewer & Merge Control
          </h2>
          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3">
            <span>Target: <strong className="text-emerald-400">{getRefLabel(target, targetBranch)}</strong></span>
            <span>Source: <strong className="text-indigo-400">{getRefLabel(source, sourceBranch)}</strong></span>
          </div>
        </div>
      </div>

      {/* Alert Block for Conflicts */}
      {diffData.conflicts.length > 0 && (
        <div className="p-4 bg-red-950/20 border-b border-red-900/50 flex flex-col gap-2">
          <div className="flex items-start space-x-2 text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold">
                Merge Conflicts Detected ({diffData.conflicts.length})
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                The memory states contain semantic or direct contradictions that must be resolved before merging.
              </p>
            </div>
          </div>

          <div className="max-h-40 overflow-y-auto bg-black/40 rounded p-2 border border-red-950 space-y-2 mt-2">
            {diffData.conflicts.map((c, idx) => (
              <div key={idx} className="text-xs border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                <div className="flex flex-col gap-1 text-[11px] text-zinc-400">
                  <span className="text-emerald-500">Target fact: "{c.factA}"</span>
                  <span className="text-indigo-500">Source fact: "{c.factB}"</span>
                  <span className="text-red-400 italic">Reason: {c.reason}</span>
                </div>
              </div>
            ))}
          </div>

          {canMerge ? (
            <button
              onClick={onStartResolution}
              className="mt-2 flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white font-semibold self-start transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span>Resolve Conflicts</span>
            </button>
          ) : (
            <p className="text-[11px] text-zinc-500 italic mt-1">
              Target is not writeable (not a branch HEAD). Cannot resolve/merge.
            </p>
          )}
        </div>
      )}

      {/* Direct Merge / No Conflicts Control */}
      {diffData.conflicts.length === 0 && (
        <div className="p-4 bg-zinc-900/40 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center space-x-2 text-emerald-400 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="font-medium">No conflicts detected. Clean merge possible.</span>
          </div>

          {canMerge ? (
            <button
              onClick={handleDirectMerge}
              disabled={isMerging}
              className="flex items-center space-x-1.5 px-4 py-2 rounded text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold transition-all shadow-md"
            >
              <GitMerge className="w-4 h-4" />
              <span>{isMerging ? "Merging..." : "Merge Branches"}</span>
            </button>
          ) : (
            <span className="text-xs text-zinc-500 italic">
              {!isTargetWriteable
                ? "Target is read-only (past commit)."
                : "Cannot merge identical or missing branches."}
            </span>
          )}
        </div>
      )}

      {/* General Error Banner */}
      {errorMsg && (
        <div className="mx-4 mt-4 p-3 bg-red-950/40 border border-red-900/60 rounded text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Side-by-side Three-Column Fact Viewer */}
      <div className="flex-1 overflow-hidden grid grid-cols-3 gap-px bg-[#27272a] h-full">
        {/* Left Column: Unique to Target */}
        <div className="flex flex-col bg-[#0c0c0e] h-full overflow-hidden">
          <div className="p-3 border-b border-[#27272a] bg-[#18181b] text-xs font-semibold text-emerald-400 truncate">
            Unique to Target
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {diffData.uniqueTarget.length === 0 ? (
              <p className="text-xs text-zinc-600 italic">No unique target facts</p>
            ) : (
              diffData.uniqueTarget.map((fact, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-emerald-950/10 border border-emerald-900/40 text-xs text-emerald-300 leading-normal"
                >
                  {fact}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Middle Column: Shared */}
        <div className="flex flex-col bg-[#0c0c0e] h-full overflow-hidden">
          <div className="p-3 border-b border-[#27272a] bg-[#18181b] text-xs font-semibold text-zinc-400 truncate">
            Shared Facts
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {diffData.shared.length === 0 ? (
              <p className="text-xs text-zinc-600 italic">No shared facts</p>
            ) : (
              diffData.shared.map((fact, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-zinc-900/50 border border-zinc-800 text-xs text-zinc-300 leading-normal"
                >
                  {fact}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Unique to Source */}
        <div className="flex flex-col bg-[#0c0c0e] h-full overflow-hidden">
          <div className="p-3 border-b border-[#27272a] bg-[#18181b] text-xs font-semibold text-indigo-400 truncate">
            Unique to Source
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {diffData.uniqueSource.length === 0 ? (
              <p className="text-xs text-zinc-600 italic">No unique source facts</p>
            ) : (
              diffData.uniqueSource.map((fact, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-indigo-950/10 border border-indigo-900/40 text-xs text-indigo-300 leading-normal"
                >
                  {fact}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
