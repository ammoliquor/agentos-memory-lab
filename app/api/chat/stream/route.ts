import { NextRequest } from "next/server";
import { addMessage } from "@/lib/db/db";
import { MultiAgentOrchestrator } from "@/lib/agents/orchestrator";
import { Message } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { message, branchId } = await req.json();

    if (!message || !branchId) {
      return new Response("Missing message or branchId", { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 1. Save and emit the user message
          const userMsg: Message = {
            id: `msg_u_${Date.now()}`,
            branchId,
            role: "user",
            content: message,
            timestamp: Date.now(),
          };
          await addMessage(userMsg);
          sendEvent("message", userMsg);

          // 2. Start orchestration
          const orchestrator = new MultiAgentOrchestrator();
          
          // Define sub-branch names for parallel execution to avoid collisions
          const timestamp = Date.now();
          const subBranchNames = {
            researcher: `research-${branchId}-${timestamp}`,
            critic: `critic-${branchId}-${timestamp}`,
            builder: `builder-${branchId}-${timestamp}`,
          };

          sendEvent("status", { state: "orchestrating", subBranches: subBranchNames });

          // Run the agent pipeline in parallel
          const pipeline = await orchestrator.runParallelPipeline(branchId, message, subBranchNames);

          // 3. Process and stream Researcher Agent output
          const researcherMsg: Message = {
            id: `msg_res_${Date.now()}`,
            branchId,
            role: "assistant",
            agentType: "researcher",
            content: `Researcher Agent completed facts on branch: ${subBranchNames.researcher}\n\nFacts:\n- ${pipeline.researcher.commit.facts.join("\n- ")}`,
            timestamp: Date.now(),
          };
          await addMessage(researcherMsg);
          sendEvent("message", researcherMsg);

          // 4. Process and stream Critic Agent output
          const criticMsg: Message = {
            id: `msg_cri_${Date.now()}`,
            branchId,
            role: "assistant",
            agentType: "critic",
            content: `Critic Agent completed counter-arguments on branch: ${subBranchNames.critic}\n\nWeaknesses & Tradeoffs:\n- ${pipeline.critic.commit.facts.join("\n- ")}`,
            timestamp: Date.now() + 10,
          };
          await addMessage(criticMsg);
          sendEvent("message", criticMsg);

          // 5. Process and stream Builder Agent output
          const builderMsg: Message = {
            id: `msg_bld_${Date.now()}`,
            branchId,
            role: "assistant",
            agentType: "builder",
            content: `Builder Agent completed recommendation plan on branch: ${subBranchNames.builder}\n\nStrategic Design:\n- ${pipeline.builder.commit.facts.join("\n- ")}`,
            timestamp: Date.now() + 20,
          };
          await addMessage(builderMsg);
          sendEvent("message", builderMsg);

          sendEvent("status", { state: "done" });
        } catch (err: any) {
          sendEvent("error", { message: err.message || String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
