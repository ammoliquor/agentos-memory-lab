import { getBranches, getMessages, addBranch } from "@/lib/db/db";
import Sidebar from "@/components/Sidebar";
import ChatContainer from "@/components/ChatContainer";
import ActiveBranchHeader from "@/components/ActiveBranchHeader";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ branchId: string }>;
}

export default async function BranchPage({ params }: PageProps) {
  const { branchId } = await params;
  let branches = await getBranches();
  
  // Ensure "main" branch exists in database
  if (!branches.some(b => b.id === "main")) {
    const mainBranch = { id: "main", name: "main", parentBranchId: null };
    try {
      await addBranch(mainBranch);
      branches = await getBranches();
    } catch (e) {
      // If it fails (e.g. concurrent execution or already exists via ID), reload branches
      try {
        branches = await getBranches();
      } catch (e2) {
        branches = [mainBranch, ...branches];
      }
    }
  }

  // Verify branch validity
  const activeBranch = branches.find((b) => b.id === branchId);
  if (!activeBranch && branchId !== "main") {
    notFound();
  }

  const activeBranchOrDefault = activeBranch || { id: "main", name: "main", parentBranchId: null };

  // Fetch conversations associated with the branch
  const initialMessages = await getMessages(branchId);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar - lists branches and highlights the active branch */}
      <Sidebar branches={branches} activeBranchId={branchId} />
      
      {/* Workspace Area */}
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#09090b]">
        <ActiveBranchHeader branch={activeBranchOrDefault} />
        <ChatContainer branchId={branchId} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
