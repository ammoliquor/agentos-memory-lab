"use server";

import { getCommits, getBranches, readDb } from "@/lib/db/db";
import { diffFacts, detectConflicts, mergeBranches, recallFacts } from "@/lib/memory/merge";
import { Commit, Branch, Conflict } from "@/lib/types";

export async function fetchCommitsAndBranches() {
  try {
    const commits = await getCommits();
    const branches = await getBranches();
    return { commits, branches };
  } catch (err: any) {
    console.error("Error fetching commits and branches:", err);
    return { commits: [], branches: [] };
  }
}

export async function getBranchDiff(sourceBranchId: string, targetBranchId: string) {
  try {
    const db = await readDb();
    const factsSource = recallFacts(sourceBranchId, db);
    const factsTarget = recallFacts(targetBranchId, db);
    return diffFacts(factsTarget, factsSource);
  } catch (err: any) {
    console.error("Error in getBranchDiff Server Action:", err);
    throw err;
  }
}

export async function getBranchConflicts(sourceBranchId: string, targetBranchId: string) {
  try {
    const db = await readDb();
    const factsSource = recallFacts(sourceBranchId, db);
    const factsTarget = recallFacts(targetBranchId, db);
    const diff = diffFacts(factsTarget, factsSource);
    const conflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);
    return conflicts;
  } catch (err: any) {
    console.error("Error in getBranchConflicts Server Action:", err);
    throw err;
  }
}

export async function submitMergeResolution(sourceBranchId: string, targetBranchId: string, resolvedFacts: string[]) {
  try {
    const commit = await mergeBranches(sourceBranchId, targetBranchId, resolvedFacts);
    return { success: true, commit };
  } catch (err: any) {
    console.error("Error in submitMergeResolution Server Action:", err);
    return { success: false, error: err.message || String(err) };
  }
}
