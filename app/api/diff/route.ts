import { NextRequest, NextResponse } from "next/server";
import { readDb } from "@/lib/db/db";
import { diffFacts, detectConflicts, recallFacts } from "@/lib/memory/merge";
import { DatabaseSchema, Commit } from "@/lib/types";

function normalizeFact(fact: string): string {
  return fact.toLowerCase().trim().replace(/\.+$/, '');
}

function getBranchHeadCommitId(branchId: string, db: DatabaseSchema): string | null {
  const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
  if (!branchObj) return null;

  const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
  if (branchCommits.length > 0) {
    branchCommits.sort((a, b) => b.timestamp - a.timestamp);
    return branchCommits[0].id;
  }
  if (branchObj.forkCommitId) {
    return branchObj.forkCommitId;
  }

  let parentId = branchObj.parentBranchId;
  const visitedBranches = new Set<string>([branchObj.id]);
  while (parentId) {
    if (visitedBranches.has(parentId)) break;
    visitedBranches.add(parentId);
    
    const parentObj = db.branches.find(b => b.id === parentId || b.name === parentId);
    if (!parentObj) break;
    const parentCommits = db.commits.filter(c => c.branchId === parentObj.id);
    if (parentCommits.length > 0) {
      parentCommits.sort((a, b) => b.timestamp - a.timestamp);
      return parentCommits[0].id;
    }
    parentId = parentObj.parentBranchId;
  }
  return null;
}

function getAncestorCommits(startCommitId: string | null, db: DatabaseSchema): Commit[] {
  if (!startCommitId) return [];
  const commitMap = new Map<string, Commit>();
  for (const c of db.commits) {
    commitMap.set(c.id, c);
  }

  const visited = new Set<string>();
  const list: Commit[] = [];
  const queue: string[] = [startCommitId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const commit = commitMap.get(currentId);
    if (commit) {
      list.push(commit);
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(',');
        for (const p of parents) {
          const trimmed = p.trim();
          if (trimmed && !visited.has(trimmed)) {
            queue.push(trimmed);
          }
        }
      } else {
        const branchObj = db.branches.find(b => b.id === commit.branchId);
        if (branchObj && branchObj.parentBranchId) {
          const parentStartId = branchObj.forkCommitId || getBranchHeadCommitId(branchObj.parentBranchId, db);
          if (parentStartId && !visited.has(parentStartId)) {
            queue.push(parentStartId);
          }
        }
      }
    }
  }
  return list.sort((a, b) => a.timestamp - b.timestamp);
}

function getFactsForRef(ref: string, db: DatabaseSchema): string[] {
  const branch = db.branches.find(b => b.id === ref || b.name === ref);
  let headCommitId: string | null = null;
  if (branch) {
    headCommitId = getBranchHeadCommitId(branch.id, db);
  } else {
    const commit = db.commits.find(c => c.id === ref);
    if (commit) {
      headCommitId = commit.id;
    }
  }

  if (!headCommitId) return [];

  const activeNormalized = new Set<string>();
  const originalCaseMap = new Map<string, string>();

  const ancestors = getAncestorCommits(headCommitId, db);

  for (const commit of ancestors) {
    if (commit.retractions) {
      for (const r of commit.retractions) {
        activeNormalized.delete(normalizeFact(r));
      }
    }
    for (const fact of commit.facts) {
      const normFact = normalizeFact(fact);
      activeNormalized.add(normFact);
      originalCaseMap.set(normFact, fact);
    }
  }

  return Array.from(activeNormalized).map(norm => originalCaseMap.get(norm)!);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get("source");
    const target = searchParams.get("target");

    if (!source || !target) {
      return NextResponse.json(
        { message: "Both source and target query parameters are required" },
        { status: 400 }
      );
    }

    const db = await readDb();
    const factsSource = getFactsForRef(source, db);
    const factsTarget = getFactsForRef(target, db);

    const diff = diffFacts(factsTarget, factsSource);
    const conflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);

    return NextResponse.json({
      shared: diff.shared,
      uniqueTarget: diff.uniqueA,
      uniqueSource: diff.uniqueB,
      conflicts,
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { message: err.message || "Failed to calculate diff" },
      { status: 500 }
    );
  }
}
