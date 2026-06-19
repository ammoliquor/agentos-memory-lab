"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, X } from "lucide-react";

interface ForkModalProps {
  parentBranchId: string;
  onClose: () => void;
}

export default function ForkModal({ parentBranchId, onClose }: ForkModalProps) {
  const router = useRouter();
  const [branchName, setBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      // Create branch through an API route (or Server Action equivalent)
      const res = await fetch("/api/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: branchName, from: parentBranchId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to fork branch");
      }

      router.refresh();
      router.push(`/branch/${branchName}`);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
          <span className="flex items-center gap-2 font-medium text-sm text-white">
            <GitBranch className="w-4 h-4 text-indigo-400" />
            Fork Branch: {parentBranchId}
          </span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
              New Branch Name
            </label>
            <input
              type="text"
              autoFocus
              required
              disabled={isLoading}
              placeholder="e.g. feature-query-cache"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="w-full bg-zinc-900 border border-[#27272a] rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}

          <div className="flex justify-end gap-2 text-sm pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-3 py-2 bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50"
            >
              {isLoading ? "Forking..." : "Fork Branch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
