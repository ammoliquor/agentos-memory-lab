"use client";

import React, { useState } from "react";
import { Branch, Conflict } from "@/lib/types";
import { AlertCircle, ArrowLeft, CheckCircle } from "lucide-react";

interface ConflictResolverProps {
  sourceBranch: Branch;
  targetBranch: Branch;
  conflicts: Conflict[];
  onSuccess: () => void;
  onCancel: () => void;
}

type ResolutionType = "target" | "source" | "both" | "custom";

interface ResolutionState {
  type: ResolutionType;
  customText: string;
}

export default function ConflictResolver({
  sourceBranch,
  targetBranch,
  conflicts,
  onSuccess,
  onCancel,
}: ConflictResolverProps) {
  // Initialize resolution state for each conflict
  const [resolutions, setResolutions] = useState<Record<number, ResolutionState>>(
    () => {
      const initial: Record<number, ResolutionState> = {};
      conflicts.forEach((_, idx) => {
        initial[idx] = { type: "target", customText: "" };
      });
      return initial;
    }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleOptionChange = (idx: number, type: ResolutionType) => {
    setResolutions((prev) => ({
      ...prev,
      [idx]: {
        ...prev[idx],
        type,
      },
    }));
  };

  const handleCustomTextChange = (idx: number, text: string) => {
    setResolutions((prev) => ({
      ...prev,
      [idx]: {
        ...prev[idx],
        customText: text,
      },
    }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    // Compile resolvedFacts list based on user selection
    const resolvedFacts: string[] = [];
    conflicts.forEach((c, idx) => {
      const res = resolutions[idx];
      if (res.type === "target") {
        resolvedFacts.push(c.factA);
      } else if (res.type === "source") {
        resolvedFacts.push(c.factB);
      } else if (res.type === "both") {
        resolvedFacts.push(c.factA);
        resolvedFacts.push(c.factB);
      } else if (res.type === "custom") {
        if (res.customText.trim()) {
          resolvedFacts.push(res.customText.trim());
        }
      }
    });

    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceBranchId: sourceBranch.id,
          targetBranchId: targetBranch.id,
          resolvedFacts,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to merge with resolved facts");
      }

      onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred while submitting resolution");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] border-t lg:border-t-0 lg:border-l border-[#27272a] text-white">
      {/* Header */}
      <div className="p-4 border-b border-[#27272a] bg-[#18181b] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={onCancel}
            className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white"
            title="Back to Diff"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-400">
              Conflict Resolution Panel
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Merging <span className="text-indigo-400 font-semibold">{sourceBranch.name}</span> into{" "}
              <span className="text-emerald-400 font-semibold">{targetBranch.name}</span>
            </p>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex items-center space-x-1.5 px-4 py-2 rounded text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold transition-all shadow-md"
        >
          <CheckCircle className="w-4 h-4" />
          <span>{isSubmitting ? "Submitting..." : "Confirm Resolution"}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="m-4 p-3 bg-red-950/40 border border-red-900/60 rounded text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Conflicts List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {conflicts.map((conflict, idx) => {
          const state = resolutions[idx] || { type: "target", customText: "" };

          return (
            <div
              key={idx}
              className="border border-[#27272a] rounded-lg bg-[#18181b]/50 overflow-hidden flex flex-col"
            >
              {/* Conflict header banner */}
              <div className="p-3 bg-red-950/15 border-b border-[#27272a] flex items-center space-x-2 text-xs font-semibold text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Conflict #{idx + 1}: {conflict.reason}</span>
              </div>

              {/* Side-by-side details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border-b border-[#27272a]/60 bg-black/10">
                <div className="space-y-1">
                  <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">
                    Target Fact (A)
                  </span>
                  <div className="p-2.5 rounded bg-emerald-950/10 border border-emerald-900/30 text-xs text-emerald-300 leading-normal">
                    {conflict.factA}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">
                    Source Fact (B)
                  </span>
                  <div className="p-2.5 rounded bg-indigo-950/10 border border-indigo-900/30 text-xs text-indigo-300 leading-normal">
                    {conflict.factB}
                  </div>
                </div>
              </div>

              {/* Resolution options */}
              <div className="p-4 space-y-3 bg-[#18181b]/35">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider block">
                  Select Resolution Strategy
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Keep Target */}
                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer select-none transition-all ${
                      state.type === "target"
                        ? "border-emerald-600 bg-emerald-950/10 text-white"
                        : "border-[#27272a] hover:border-zinc-700 bg-zinc-950/20 text-zinc-400"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name={`conflict-${idx}`}
                        checked={state.type === "target"}
                        onChange={() => handleOptionChange(idx, "target")}
                        className="accent-emerald-500"
                      />
                      <span className="text-xs font-semibold">Keep Target (A)</span>
                    </div>
                  </label>

                  {/* Keep Source */}
                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer select-none transition-all ${
                      state.type === "source"
                        ? "border-indigo-600 bg-indigo-950/10 text-white"
                        : "border-[#27272a] hover:border-zinc-700 bg-zinc-950/20 text-zinc-400"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name={`conflict-${idx}`}
                        checked={state.type === "source"}
                        onChange={() => handleOptionChange(idx, "source")}
                        className="accent-indigo-500"
                      />
                      <span className="text-xs font-semibold">Keep Source (B)</span>
                    </div>
                  </label>

                  {/* Keep Both */}
                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer select-none transition-all ${
                      state.type === "both"
                        ? "border-zinc-500 bg-zinc-900/40 text-white"
                        : "border-[#27272a] hover:border-zinc-700 bg-zinc-950/20 text-zinc-400"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name={`conflict-${idx}`}
                        checked={state.type === "both"}
                        onChange={() => handleOptionChange(idx, "both")}
                        className="accent-zinc-400"
                      />
                      <span className="text-xs font-semibold">Keep Both</span>
                    </div>
                  </label>
                </div>

                {/* Custom Synthesized Fact Option */}
                <div className="mt-2">
                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer select-none transition-all ${
                      state.type === "custom"
                        ? "border-amber-600 bg-amber-950/10 text-white"
                        : "border-[#27272a] hover:border-zinc-700 bg-zinc-950/20 text-zinc-400"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name={`conflict-${idx}`}
                        checked={state.type === "custom"}
                        onChange={() => handleOptionChange(idx, "custom")}
                        className="accent-amber-500"
                      />
                      <span className="text-xs font-semibold">Write Custom Synthesized Fact</span>
                    </div>

                    {state.type === "custom" && (
                      <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                        <textarea
                          value={state.customText}
                          onChange={(e) => handleCustomTextChange(idx, e.target.value)}
                          placeholder="Synthesize a combined or corrected fact here..."
                          className="w-full h-20 p-2 text-xs bg-zinc-950 border border-zinc-800 rounded focus:border-amber-500 focus:outline-none text-white leading-normal"
                        />
                      </div>
                    )}
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
