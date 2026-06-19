"use client";

import Link from "next/link";
import { Branch } from "@/lib/types";
import { GitBranch, Plus, Database, GitGraph } from "lucide-react";
import { useState } from "react";
import ForkModal from "./ForkModal";

interface SidebarProps {
  branches: Branch[];
  activeBranchId?: string;
}

export default function Sidebar({ branches, activeBranchId }: SidebarProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <aside className="w-64 bg-[#18181b] border-r border-[#27272a] flex flex-col h-full select-none">
      {/* App Branding Header */}
      <div className="p-4 border-b border-[#27272a] flex items-center space-x-2">
        <Database className="w-5 h-5 text-indigo-500" />
        <span className="font-semibold text-sm tracking-tight text-white">AgentOS Memory Lab</span>
      </div>

      {/* Top Level Navigation */}
      <div className="px-2 pt-3 pb-2 border-b border-[#27272a] space-y-0.5">
        <Link
          href="/dag"
          className={`flex items-center space-x-2.5 px-3 py-2 rounded-md text-sm transition-all group ${
            activeBranchId === "DAG_VIEW"
              ? "bg-zinc-800 text-white font-medium shadow-inner"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <GitGraph className={`w-4 h-4 ${activeBranchId === "DAG_VIEW" ? "text-indigo-400" : "text-zinc-500"}`} />
          <span className="truncate flex-1">Commit Graph (DAG)</span>
        </Link>
      </div>

      {/* Navigation Headers and Actions */}
      <div className="p-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 tracking-wider uppercase">Memory Branches</span>
        <button
          onClick={() => setIsModalOpen(true)}
          className="p-1 hover:bg-[#27272a] rounded transition-colors text-zinc-400 hover:text-white"
          title="Fork active branch"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Branch List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {branches.map((b) => {
          const isActive = b.id === activeBranchId;
          return (
            <Link
              key={b.id}
              href={`/branch/${b.id}`}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-md text-sm transition-all group ${
                isActive
                  ? "bg-zinc-800 text-white font-medium shadow-inner"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <GitBranch className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-zinc-500"}`} />
              <span className="truncate flex-1">{b.name}</span>
              {isActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-950" title="Active Context" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Action Dialog / Modal */}
      {isModalOpen && activeBranchId && activeBranchId !== "DAG_VIEW" && (
        <ForkModal
          parentBranchId={activeBranchId}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-[#27272a] text-xs text-zinc-500">
        Workspace: <span className="font-mono text-zinc-300">memfork-lab</span>
      </div>
    </aside>
  );
}
