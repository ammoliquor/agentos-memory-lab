import { getBranches } from "@/lib/db/db";
import Sidebar from "@/components/Sidebar";
import DAGWorkspace from "@/components/DAGWorkspace";

export default async function DAGPage() {
  const branches = await getBranches();

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar branches={branches} activeBranchId="DAG_VIEW" />
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#09090b]">
        <DAGWorkspace />
      </div>
    </div>
  );
}
