"use client";

import React, { useState, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  Node,
  Edge,
  MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Commit, Branch } from '@/lib/types';
import { fetchCommitsAndBranches } from '@/app/actions/dbActions';
import { Calendar, GitCommit, GitBranch, ArrowRight, CheckCircle2, Trash2 } from 'lucide-react';

// Custom Commit Node component
const CommitNode = ({ data }: { data: any }) => {
  const isSelected = data.isSelected;
  return (
    <div className={`p-3 rounded-lg border text-white text-xs w-52 shadow-lg transition-all ${
      isSelected 
        ? 'border-indigo-500 bg-zinc-900 ring-2 ring-indigo-950/70' 
        : 'border-zinc-800 bg-zinc-950/90 hover:border-zinc-700 hover:bg-zinc-900/50'
    }`}>
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-zinc-700 border border-zinc-900 !rounded-full" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[9px] text-zinc-500 font-bold uppercase tracking-wider">{data.id}</span>
        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] text-zinc-400 font-mono max-w-[100px] truncate" title={data.branchId}>
          {data.branchId}
        </span>
      </div>
      <div className="font-semibold text-zinc-200 truncate mb-1" title={data.message}>
        {data.message}
      </div>
      <div className="flex justify-between items-center text-[9px] text-zinc-500">
        <span>{new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="bg-indigo-950/40 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-900/30 font-medium text-[9px]">
          {data.factsCount} {data.factsCount === 1 ? 'fact' : 'facts'}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-zinc-700 border border-zinc-900 !rounded-full" />
    </div>
  );
};

const nodeTypes = {
  commitNode: CommitNode
};

interface DagVisualizerProps {
  initialCommits?: Commit[];
  initialBranches?: Branch[];
  onSelectCommit?: (commit: Commit) => void;
}

export default function DagVisualizer({ 
  initialCommits, 
  initialBranches,
  onSelectCommit 
}: DagVisualizerProps) {
  const [mounted, setMounted] = useState(false);
  const [commits, setCommits] = useState<Commit[]>(initialCommits || []);
  const [branches, setBranches] = useState<Branch[]>(initialBranches || []);
  const [localSelectedCommit, setLocalSelectedCommit] = useState<Commit | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (initialCommits) {
      setCommits(initialCommits);
    }
    if (initialBranches) {
      setBranches(initialBranches);
    }
  }, [initialCommits, initialBranches]);

  useEffect(() => {
    if (!initialCommits || !initialBranches) {
      const loadData = async () => {
        const data = await fetchCommitsAndBranches();
        if (!initialCommits) setCommits(data.commits);
        if (!initialBranches) setBranches(data.branches);
      };
      loadData();
    }
  }, []);

  const selectedCommitId = localSelectedCommit?.id;

  const { nodes, edges } = useMemo(() => {
    if (commits.length === 0) return { nodes: [], edges: [] };

    // Unique branches sorted (main first, then alphabetically)
    const uniqueBranches = Array.from(new Set(commits.map(c => c.branchId)));
    uniqueBranches.sort((a, b) => {
      if (a === 'main') return -1;
      if (b === 'main') return 1;
      return a.localeCompare(b);
    });

    const branchCols: { [branchId: string]: number } = {};
    uniqueBranches.forEach((bId, idx) => {
      branchCols[bId] = idx;
    });

    // Compute depth
    const depths: { [id: string]: number } = {};
    const visited = new Set<string>();
    const getDepth = (id: string): number => {
      if (id in depths) return depths[id];
      if (visited.has(id)) return 0;
      visited.add(id);

      const commit = commits.find(c => c.id === id);
      if (!commit || !commit.parentCommit) {
        depths[id] = 0;
        visited.delete(id);
        return 0;
      }

      const parents = commit.parentCommit.split(',').map(p => p.trim()).filter(Boolean);
      let maxParentDepth = -1;
      for (const p of parents) {
        maxParentDepth = Math.max(maxParentDepth, getDepth(p));
      }
      depths[id] = maxParentDepth + 1;
      visited.delete(id);
      return depths[id];
    };

    const newNodes: Node[] = commits.map(commit => {
      const col = branchCols[commit.branchId] ?? 0;
      const depth = getDepth(commit.id);
      return {
        id: commit.id,
        type: 'commitNode',
        data: {
          id: commit.id,
          branchId: commit.branchId,
          message: commit.message,
          factsCount: commit.facts.length,
          timestamp: commit.timestamp,
          isSelected: selectedCommitId === commit.id,
          facts: commit.facts,
          retractions: commit.retractions || []
        },
        position: {
          x: col * 260 + 50,
          y: depth * 140 + 50
        }
      };
    });

    const newEdges: Edge[] = [];
    commits.forEach(commit => {
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(',').map(p => p.trim()).filter(Boolean);
        parents.forEach(pId => {
          if (commits.some(c => c.id === pId)) {
            newEdges.push({
              id: `e_${pId}_${commit.id}`,
              source: pId,
              target: commit.id,
              animated: parents.length > 1,
              style: {
                stroke: parents.length > 1 ? '#6366f1' : '#4b5563',
                strokeWidth: 2
              }
            });
          }
        });
      }
    });

    return { nodes: newNodes, edges: newEdges };
  }, [commits, selectedCommitId]);

  const onNodeClick = (_evt: React.MouseEvent, node: Node) => {
    const commit = commits.find(c => c.id === node.id);
    if (commit) {
      setLocalSelectedCommit(commit);
      if (onSelectCommit) {
        onSelectCommit(commit);
      }
    }
  };

  if (!mounted) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#09090b] text-zinc-500 border border-[#27272a] rounded-xl min-h-[400px]">
        <div className="flex flex-col items-center space-y-2">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-medium">Initializing Commit Graph...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-[#09090b] border border-[#27272a] rounded-xl overflow-hidden min-h-[450px]">
      {/* Graph Area */}
      <div className="flex-1 h-[400px] md:h-full relative bg-[#09090b] select-none">
        {commits.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 space-y-2">
            <GitCommit className="w-8 h-8 text-zinc-700" />
            <p className="text-sm font-medium">No commits in DAG</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background color="#27272a" gap={20} size={1} />
            <Controls className="!bg-zinc-900 !border-zinc-800 !text-white [&>button]:!border-zinc-800 [&>button]:!bg-zinc-900 [&>button]:hover:!bg-zinc-800 [&>button]:!fill-zinc-400 [&>button]:hover:!fill-white" />
            <MiniMap 
              nodeColor={() => '#1f1f22'} 
              maskColor="rgba(9, 9, 11, 0.7)" 
              style={{ backgroundColor: '#09090b', border: '1px solid #27272a' }}
            />
          </ReactFlow>
        )}
      </div>

      {/* Details Side Panel */}
      <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[#27272a] bg-[#0c0c0e] p-4 flex flex-col overflow-y-auto select-text">
        {localSelectedCommit ? (
          <div className="flex flex-col h-full space-y-4">
            <div className="flex items-start justify-between border-b border-[#27272a] pb-3">
              <div>
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">Selected Commit</span>
                <h3 className="text-sm font-mono font-bold text-white mt-0.5">{localSelectedCommit.id}</h3>
              </div>
              <span className="px-2 py-0.5 rounded bg-indigo-950/40 text-indigo-400 border border-indigo-900/30 text-[10px] font-mono">
                {localSelectedCommit.branchId}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 font-medium">Message</span>
              <p className="text-zinc-200 text-sm font-semibold leading-relaxed bg-zinc-950 p-2.5 rounded-lg border border-[#27272a]">
                {localSelectedCommit.message}
              </p>
            </div>

            <div className="flex items-center space-x-2 text-[10px] text-zinc-400 bg-zinc-900/50 p-2 rounded-md border border-zinc-900">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
              <span>{new Date(localSelectedCommit.timestamp).toLocaleString()}</span>
            </div>

            {/* Parent Info */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 font-medium">Lineage Parent(s)</span>
              <div className="flex flex-wrap gap-1 text-[10px] font-mono">
                {localSelectedCommit.parentCommit ? (
                  localSelectedCommit.parentCommit.split(',').map((p) => (
                    <span 
                      key={p} 
                      onClick={() => {
                        const targetParent = commits.find(c => c.id === p.trim());
                        if (targetParent) setLocalSelectedCommit(targetParent);
                      }}
                      className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer transition-colors"
                    >
                      {p.trim()}
                    </span>
                  ))
                ) : (
                  <span className="text-zinc-600 italic">None (Root Commit)</span>
                )}
              </div>
            </div>

            {/* Facts Asserted */}
            <div className="flex-1 flex flex-col space-y-1.5">
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Asserted Facts</span>
              </div>
              <ul className="space-y-1 overflow-y-auto max-h-40 md:max-h-none flex-1">
                {localSelectedCommit.facts.map((fact, index) => (
                  <li key={index} className="text-xs text-zinc-300 bg-zinc-950/70 border border-zinc-900 rounded p-2 hover:border-zinc-800 transition-colors">
                    {fact}
                  </li>
                ))}
                {localSelectedCommit.facts.length === 0 && (
                  <li className="text-xs text-zinc-500 italic bg-zinc-950/40 p-2 rounded border border-dashed border-zinc-900 text-center">
                    No facts asserted
                  </li>
                )}
              </ul>
            </div>

            {/* Facts Retracted */}
            {localSelectedCommit.retractions && localSelectedCommit.retractions.length > 0 && (
              <div className="flex flex-col space-y-1.5 pt-2 border-t border-[#27272a]">
                <div className="flex items-center space-x-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-[10px] text-rose-400 font-semibold uppercase tracking-wider">Retracted Facts</span>
                </div>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {localSelectedCommit.retractions.map((fact, index) => (
                    <li key={index} className="text-xs text-rose-300 bg-rose-950/20 border border-rose-950/40 rounded p-2 font-mono">
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-center p-4 space-y-2">
            <GitBranch className="w-6 h-6 text-zinc-700" />
            <p className="text-xs">Click a commit node in the DAG to inspect its details and asserted facts</p>
          </div>
        )}
      </div>
    </div>
  );
}
