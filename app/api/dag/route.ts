import { NextResponse } from "next/server";
import { getBranches, getCommits } from "@/lib/db/db";

export async function GET() {
  try {
    const branches = await getBranches();
    const commits = await getCommits();
    return NextResponse.json({ branches, commits }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { message: err.message || "Failed to fetch DAG data" },
      { status: 500 }
    );
  }
}
