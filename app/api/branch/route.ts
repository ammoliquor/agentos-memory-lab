import { NextRequest, NextResponse } from "next/server";
import { branch } from "@/lib/memory/memfork";

export async function POST(req: NextRequest) {
  try {
    const { name, from } = await req.json();

    if (!name) {
      return NextResponse.json({ message: "Branch name is required" }, { status: 400 });
    }

    // Call the branch creation function
    await branch(name, from);

    return NextResponse.json({ message: "Branch created successfully", name }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ message: err.message || "Failed to create branch" }, { status: 500 });
  }
}
