"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Branch, Commit, Conflict } from "@/lib/types";
import CommitDAG from "./CommitDAG";
import DiffViewer from "./DiffViewer";
import ConflictResolver from "./ConflictResolver";

interface DiffData {
  shared: string[];
  uniqueTarget: string[];
  uniqueSource: string[];
  conflicts: Conflict[];
}

export default function DAGWorkspace() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection states
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Diff states
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Fetch DAG (branches and commits)
  const fetchDAG = async () => {
    try {
      const res = await fetch("/api/dag");
      if (!res.ok) {
        throw new Error("Failed to fetch DAG data");
      }
      const data = await res.json();
      setBranches(data.branches || []);
      setCommits(data.commits || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || "An error occurred fetching DAG data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDAG();
  }, []);

  // Fetch diff details
  const fetchDiff = async () => {
    if (!selectedTargetId || !selectedSourceId) return;
    setDiffLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/diff?source=${selectedSourceId}&target=${selectedTargetId}`
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to fetch diff");
      }
      const data = await res.json();
      setDiffData(data);
      setShowDiff(true);
      setIsResolving(false);
    } catch (err: any) {
      setError(err.message || "Failed to load diff data");
    } finally {
      setDiffLoading(false);
    }
  };

  const handleMergeSuccess = async () => {
    // Reset selection and diff states
    setSelectedTargetId(null);
    setSelectedSourceId(null);
    setShowDiff(false);
    setDiffData(null);
    setIsResolving(false);

    // Refresh graph
    setLoading(true);
    await fetchDAG();
  };

  // Find writeable target branch & source branch objects for ConflictResolver
  const targetBranch = useMemo(() => {
    if (!selectedTargetId) return null;
    return (
      branches.find((b) => b.id === selectedTargetId || b.name === selectedTargetId) ||
      branches.find((b) => {
        const bCommits = commits.filter((c) => c.branchId === b.id);
        if (bCommits.length === 0) return false;
        bCommits.sort((a, b) => b.timestamp - a.timestamp);
        return bCommits[0].id === selectedTargetId;
      }) || {
        id: selectedTargetId,
        name: selectedTargetId.substring(0, 7),
        parentBranchId: null,
      }
    );
  }, [selectedTargetId, branches, commits]);

  const sourceBranch = useMemo(() => {
    if (!selectedSourceId) return null;
    return (
      branches.find((b) => b.id === selectedSourceId || b.name === selectedSourceId) ||
      branches.find((b) => {
        const bCommits = commits.filter((c) => c.branchId === b.id);
        if (bCommits.length === 0) return false;
        bCommits.sort((a, b) => b.timestamp - a.timestamp);
        return bCommits[0].id === selectedSourceId;
      }) || {
        id: selectedSourceId,
        name: selectedSourceId.substring(0, 7),
        parentBranchId: null,
      }
    );
  }, [selectedSourceId, branches, commits]);

  // Reset diff view if either selection is cleared
  useEffect(() => {
    if (!selectedTargetId || !selectedSourceId) {
      setShowDiff(false);
      setDiffData(null);
      setIsResolving(false);
    }
  }, [selectedTargetId, selectedSourceId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm bg-[#09090b]">
        Loading workspace and DAG graph...
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden">
      {/* Visual DAG Graph */}
      <div className="flex-1 h-full min-h-[450px] relative">
        {error && !showDiff && (
          <div className="absolute top-4 right-4 z-10 p-3 bg-red-950/40 border border-red-900/60 rounded text-xs text-red-300">
            {error}
          </div>
        )}
        <CommitDAG
          branches={branches}
          commits={commits}
          selectedTargetId={selectedTargetId}
          selectedSourceId={selectedSourceId}
          onSelectTarget={setSelectedTargetId}
          onSelectSource={setSelectedSourceId}
          onInitiateMerge={fetchDiff}
        />
      </div>

      {/* Diff / Conflict Resolution Sidebar */}
      {showDiff && (
        <div className="w-full lg:w-[450px] xl:w-[600px] shrink-0 h-full border-t lg:border-t-0 border-[#27272a] bg-[#0c0c0e] overflow-hidden flex flex-col">
          {diffLoading ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
              Loading diff details...
            </div>
          ) : isResolving && targetBranch && sourceBranch && diffData ? (
            <ConflictResolver
              sourceBranch={sourceBranch}
              targetBranch={targetBranch}
              conflicts={diffData.conflicts}
              onSuccess={handleMergeSuccess}
              onCancel={() => setIsResolving(false)}
            />
          ) : diffData ? (
            <DiffViewer
              target={selectedTargetId!}
              source={selectedSourceId!}
              branches={branches}
              commits={commits}
              diffData={diffData}
              onMergeSuccess={handleMergeSuccess}
              onStartResolution={() => setIsResolving(true)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
