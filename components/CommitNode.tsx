"use client";

import React from "react";
import { Handle, Position } from "reactflow";
import { Commit, Branch } from "@/lib/types";

interface CommitNodeProps {
  data: {
    commit: Commit;
    isTarget: boolean;
    isSource: boolean;
    branchColor: string;
    branchHeads: Branch[];
  };
}

export default function CommitNode({ data }: CommitNodeProps) {
  const { commit, isTarget, isSource, branchColor, branchHeads } = data;

  let borderStyle = "border-[#27272a]";
  let ringStyle = "";
  if (isTarget) {
    borderStyle = "border-emerald-500";
    ringStyle = "ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-[#09090b]";
  } else if (isSource) {
    borderStyle = "border-indigo-500";
    ringStyle = "ring-2 ring-indigo-500/50 ring-offset-2 ring-offset-[#09090b]";
  }

  return (
    <div
      className={`px-3 py-2 rounded-md bg-[#18181b] border text-white text-xs min-w-[150px] shadow-md transition-all ${borderStyle} ${ringStyle}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="w-1.5 h-1.5 !bg-zinc-500"
      />

      <div className="flex flex-col gap-1">
        {branchHeads && branchHeads.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {branchHeads.map((b) => (
              <span
                key={b.id}
                className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800"
              >
                {b.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-zinc-400 font-semibold">
            {commit.id.substring(0, 7)}
          </span>
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: branchColor }}
            title={`Branch: ${commit.branchId}`}
          />
        </div>

        <div
          className="text-[11px] text-zinc-300 truncate max-w-[130px] font-medium"
          title={commit.message}
        >
          {commit.message}
        </div>

        <div className="text-[9px] text-zinc-500">
          {commit.facts.length} fact{commit.facts.length === 1 ? "" : "s"}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-1.5 h-1.5 !bg-zinc-500"
      />
    </div>
  );
}
