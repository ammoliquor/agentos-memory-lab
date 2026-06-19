"use client";

import React, { useState, useEffect } from 'react';
import { Conflict, Commit } from '@/lib/types';
import { getBranchConflicts, submitMergeResolution } from '@/app/actions/dbActions';
import { AlertTriangle, GitMerge, ArrowRight, Check, RefreshCw, Edit3, HelpCircle } from 'lucide-react';

interface MergeConflictResolverProps {
  sourceBranchId: string;
  targetBranchId: string;
  initialConflicts?: Conflict[];
  onResolveSuccess?: (commit: Commit) => void;
  onCancel?: () => void;
}

export default function MergeConflictResolver({
  sourceBranchId,
  targetBranchId,
  initialConflicts,
  onResolveSuccess,
  onCancel
}: MergeConflictResolverProps) {
  const [conflicts, setConflicts] = useState<Conflict[]>(initialConflicts || []);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // State to store resolution for each conflict
  // We keep track of the selected type ('A' | 'B' | 'custom') and the current text value
  const [resolutions, setResolutions] = useState<{
    [index: number]: {
      type: 'A' | 'B' | 'custom';
      value: string;
    };
  }>({});

  // Fetch conflicts if not provided
  useEffect(() => {
    if (!initialConflicts && sourceBranchId && targetBranchId) {
      const fetchConflicts = async () => {
        setLoading(true);
        setError('');
        try {
          const detected = await getBranchConflicts(sourceBranchId, targetBranchId);
          setConflicts(detected);
        } catch (err: any) {
          console.error(err);
          setError(err.message || 'Failed to detect conflicts between branches');
        } finally {
          setLoading(false);
        }
      };
      fetchConflicts();
    }
  }, [initialConflicts, sourceBranchId, targetBranchId]);

  // Sync conflicts changes and initialize resolutions
  useEffect(() => {
    if (conflicts.length > 0) {
      const initial: typeof resolutions = {};
      conflicts.forEach((c, idx) => {
        // Default to Option B (incoming change) or Option A
        initial[idx] = {
          type: 'B',
          value: c.factB
        };
      });
      setResolutions(initial);
    }
  }, [conflicts]);

  const handleSelectOption = (index: number, option: 'A' | 'B') => {
    const conflict = conflicts[index];
    setResolutions(prev => ({
      ...prev,
      [index]: {
        type: option,
        value: option === 'A' ? conflict.factA : conflict.factB
      }
    }));
  };

  const handleCustomTextChange = (index: number, val: string) => {
    setResolutions(prev => ({
      ...prev,
      [index]: {
        type: 'custom',
        value: val
      }
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (conflicts.length === 0 || submitting) return;

    setSubmitting(true);
    setError('');
    
    // Gather resolutions.
    // Workaround: If the resolved fact is exactly equal to the target fact (factA),
    // we append a trailing space so the backend mergeBranches doesn't filter it out
    // via its `!factsTarget.includes(f)` check, ensuring the re-assertion survives retractions.
    const resolvedFacts = conflicts.map((c, idx) => {
      const res = resolutions[idx];
      const val = res ? res.value.trim() : c.factB;
      if (val === c.factA.trim()) {
        return val + " ";
      }
      return val;
    });

    try {
      const result = await submitMergeResolution(sourceBranchId, targetBranchId, resolvedFacts);
      if (result.success && result.commit) {
        setSuccess(true);
        if (onResolveSuccess) {
          onResolveSuccess(result.commit);
        }
      } else {
        setError(result.error || 'Failed to submit conflict resolutions');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during conflict resolution submission');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-[#09090b] border border-[#27272a] rounded-xl">
        <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
        <span className="text-sm text-zinc-400">Detecting semantic database conflicts...</span>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#09090b] border border-[#27272a] rounded-xl overflow-hidden shadow-2xl flex flex-col p-6 space-y-6">
      
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#27272a] pb-5">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-rose-950/40 text-rose-400 border border-rose-900/30">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Resolve Merge Conflicts</h2>
            <p className="text-xs text-zinc-500">
              Merging <span className="font-mono text-zinc-400">{sourceBranchId}</span> into <span className="font-mono text-zinc-400">{targetBranchId}</span>
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-md text-xs border border-zinc-800 transition-colors"
          >
            Cancel Merge
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-rose-950/20 border border-rose-900/30 rounded-lg text-xs text-rose-400 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-950/20 border border-emerald-950/40 rounded-lg text-xs text-emerald-400 flex items-center space-x-2.5">
          <Check className="w-5 h-5 shrink-0 bg-emerald-950 border border-emerald-800 rounded-full p-0.5" />
          <div>
            <p className="font-semibold">Conflicts successfully resolved!</p>
            <p className="text-zinc-400 text-[11px] mt-0.5">A new merge commit has been added to {targetBranchId}.</p>
          </div>
        </div>
      )}

      {conflicts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-zinc-500 space-y-2">
          <Check className="w-8 h-8 text-emerald-500 bg-emerald-950/20 border border-emerald-900/30 rounded-full p-1.5" />
          <p className="text-sm font-medium">No conflicts detected between these branches.</p>
          <p className="text-xs text-zinc-600">You can merge directly without resolution.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            {conflicts.map((conflict, index) => {
              const res = resolutions[index] || { type: 'B', value: conflict.factB };
              return (
                <div key={index} className="bg-zinc-950 rounded-xl border border-zinc-900 p-4 space-y-4">
                  
                  {/* Conflict Context */}
                  <div className="flex items-start justify-between bg-rose-950/10 border border-rose-950/20 rounded-lg px-3 py-2 text-xs">
                    <div className="space-y-1">
                      <span className="text-[10px] text-rose-400 uppercase font-mono tracking-wider font-semibold">
                        Conflict #{index + 1}: {conflict.reason}
                      </span>
                      <p className="text-zinc-400 text-[11px]">
                        Severity: <span className="font-semibold text-rose-300">{conflict.severity}</span>
                      </p>
                    </div>
                  </div>

                  {/* Side-by-Side Options */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Option A - Target */}
                    <div 
                      onClick={() => handleSelectOption(index, 'A')}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
                        res.type === 'A' 
                          ? 'border-indigo-500 bg-indigo-950/10 ring-1 ring-indigo-900/30' 
                          : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-700'
                      }`}
                    >
                      <div>
                        <span className="text-[9px] uppercase font-mono tracking-wider text-zinc-500 font-semibold">
                          Option A (Target Branch)
                        </span>
                        <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed">
                          {conflict.factA}
                        </p>
                      </div>
                      <div className="flex justify-end mt-3">
                        <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          res.type === 'A' ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-zinc-700'
                        }`}>
                          {res.type === 'A' && <Check className="w-2.5 h-2.5" />}
                        </span>
                      </div>
                    </div>

                    {/* Option B - Source */}
                    <div 
                      onClick={() => handleSelectOption(index, 'B')}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
                        res.type === 'B' 
                          ? 'border-indigo-500 bg-indigo-950/10 ring-1 ring-indigo-900/30' 
                          : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-700'
                      }`}
                    >
                      <div>
                        <span className="text-[9px] uppercase font-mono tracking-wider text-zinc-500 font-semibold">
                          Option B (Incoming Source Branch)
                        </span>
                        <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed">
                          {conflict.factB}
                        </p>
                      </div>
                      <div className="flex justify-end mt-3">
                        <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          res.type === 'B' ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-zinc-700'
                        }`}>
                          {res.type === 'B' && <Check className="w-2.5 h-2.5" />}
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Resolution Textbox */}
                  <div className="space-y-1.5 pt-1 border-t border-zinc-900">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-zinc-500 font-medium flex items-center space-x-1">
                        <Edit3 className="w-3 h-3 text-zinc-400" />
                        <span>Resolution Fact:</span>
                      </label>
                      {res.type !== 'custom' && (
                        <span className="text-[9px] text-zinc-600 italic">
                          (Editing text below shifts to Custom Resolution)
                        </span>
                      )}
                    </div>
                    <textarea
                      value={res.value}
                      onChange={(e) => handleCustomTextChange(index, e.target.value)}
                      rows={2}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none font-sans leading-relaxed"
                      placeholder="Specify the final merged fact description..."
                    />
                  </div>

                </div>
              );
            })}
          </div>

          {/* Submit Actions */}
          <div className="flex justify-end space-x-3 pt-3 border-t border-[#27272a]">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center space-x-2 text-xs font-semibold"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Merging and Resolving...</span>
                </>
              ) : (
                <>
                  <GitMerge className="w-3.5 h-3.5" />
                  <span>Complete Merge & Commit</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

    </div>
  );
}
