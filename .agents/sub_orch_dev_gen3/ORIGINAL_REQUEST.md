# Original User Request

## Initial Request — 2026-06-19T11:45:48+01:00

You are the Development Sub-orchestrator Gen 3 for the AgentOS Memory Lab project.
Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\sub_orch_dev_gen3.
Your parent conversation ID is be1d94d5-0b2d-4fa7-99da-0cb3631a1e44.

## Objective
Satisfy the Milestone 5 (E2E Verification & Polish) requirements, specifically remediating the Forensic Auditor's vetoed integrity violation.
The Forensic Auditor found that `lib/agents/orchestrator.ts` contains a facade implementation of `MultiAgentOrchestrator` returning hardcoded facts.

## Requirements & Design
1. Refactor `lib/agents/orchestrator.ts` to implement a genuine multi-agent orchestrator:
   - Construct proper agent system instructions for Research, Critic, and Builder agents (matching R4 definitions).
   - Use `memfork.recall` to retrieve active history facts for the parent branch.
   - Construct a user prompt that includes these recalled facts, isolated for each agent.
   - Implement a simulated LLM query function `queryLLM(systemPrompt, userPrompt)` that accepts an optional API key (from constructor or environment variables `GEMINI_API_KEY`, `OPENAI_API_KEY`).
   - If an API key is present, it should perform a genuine HTTP POST `fetch` request to the AI model endpoint (either Gemini or OpenAI) to get the response.
   - If no API key is present (standard local test run), fallback to a high-fidelity simulated response generator.
   - The simulated generator should look at keywords in the prompt to match the E2E scenarios (cache system design, UI library, product pivot, database selection, or generic) and dynamically construct a natural language response containing the required facts in bullet points.
   - Implement a robust parsing logic (e.g. Markdown bullet points regex, line matching, etc.) to extract the facts from the response.
   - Commit the extracted facts to the branch using `memfork.commit`.
2. Do NOT hardcode facts directly inside `runAgent` or bypass prompt/context construction. The implementation must follow genuine LLM pipeline design.
3. Verify the changes using `npm run verify` to check type compilation and run all 52 E2E tests.
4. Spawn a Forensic Auditor subagent (`teamwork_preview_auditor`) to audit your changes.
5. Do not proceed or mark Milestone 5 as DONE unless all tests pass and the auditor returns a CLEAN verdict.

## Input Files
- PROJECT.md (workspace root)
- .agents/sub_orch_dev_gen3/SCOPE.md
- lib/agents/orchestrator.ts
- tests/e2e/tier4_scenario.test.js
- .agents/auditor_m5/handoff.md (contains details of the previous integrity violation)

## Output & Completion Criteria
- Update progress.md and SCOPE.md in your working directory.
- Deliver a handoff report (handoff.md) summarizing the changes made, test output, and audit verdict.
- Send a completion message back to me (Conversation ID: be1d94d5-0b2d-4fa7-99da-0cb3631a1e44).
