import { NextRequest, NextResponse } from "next/server";
import { mergeBranches, diffFacts, detectConflicts, recallFacts } from "@/lib/memory/merge";
import { readDb } from "@/lib/db/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sourceBranchId, targetBranchId, resolvedFacts = [] } = body;

    if (!sourceBranchId || !targetBranchId) {
      return NextResponse.json(
        { message: "Both sourceBranchId and targetBranchId are required in body" },
        { status: 400 }
      );
    }

    try {
      const commit = await mergeBranches(sourceBranchId, targetBranchId, resolvedFacts);
      return NextResponse.json({ commit }, { status: 200 });
    } catch (err: any) {
      // If a merge conflict is detected and resolvedFacts is empty
      if (resolvedFacts.length === 0) {
        const db = await readDb();
        const sourceBranch = db.branches.find(b => b.id === sourceBranchId || b.name === sourceBranchId);
        const targetBranch = db.branches.find(b => b.id === targetBranchId || b.name === targetBranchId);
        if (sourceBranch && targetBranch) {
          const factsSource = recallFacts(sourceBranch.id, db);
          const factsTarget = recallFacts(targetBranch.id, db);
          const diff = diffFacts(factsTarget, factsSource);
          const conflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);

          if (conflicts.length > 0) {
            return NextResponse.json({ conflicts }, { status: 409 });
          }
        }
      }
      return NextResponse.json({ message: err.message || "Merge failed" }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { message: err.message || "Failed to process merge request" },
      { status: 500 }
    );
  }
}
