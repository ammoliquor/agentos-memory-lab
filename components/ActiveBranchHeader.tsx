import { Branch } from "@/lib/types";
import { GitBranch, GitFork } from "lucide-react";

interface HeaderProps {
  branch: Branch;
}

export default function ActiveBranchHeader({ branch }: HeaderProps) {
  return (
    <header className="h-14 border-b border-[#27272a] bg-[#18181b]/30 flex items-center justify-between px-6">
      {/* Title */}
      <div className="flex items-center space-x-3">
        <GitBranch className="w-5 h-5 text-indigo-400" />
        <h1 className="text-sm font-semibold text-white tracking-tight">{branch.name}</h1>
        {branch.parentBranchId && (
          <div className="flex items-center space-x-1 text-xs text-zinc-500">
            <span>branched from</span>
            <GitFork className="w-3 h-3" />
            <span className="font-mono text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-[#27272a]">
              {branch.parentBranchId}
            </span>
          </div>
        )}
      </div>

      {/* State Badge */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-zinc-400 font-medium">Head Connected</span>
      </div>
    </header>
  );
}
