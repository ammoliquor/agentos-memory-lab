# BRIEFING — 2026-06-19T11:47:46+01:00

## Mission
Analyze lib/agents/orchestrator.ts, tests/e2e/tier4_scenario.test.js, and tests/e2e/tier3_combined.test.js to recommend a refactoring strategy that addresses the integrity violation (returning hardcoded mock lists directly in runAgent).

## 🔒 My Identity
- Archetype: explorer
- Roles: Teamwork explorer, read-only investigator
- Working directory: C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m5_gen3_2
- Original parent: 0927b6b5-b20e-46ee-8a4f-b634215b264f
- Milestone: M5 Remediation

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Analyze lib/agents/orchestrator.ts, tests/e2e/tier4_scenario.test.js, and tests/e2e/tier3_combined.test.js
- Construct proper agent system instructions for Research, Critic, and Builder agents (matching R4).
- Use `recall` to retrieve active history facts for the parent branch.
- Construct a user prompt that includes these recalled facts, isolated for each agent.
- Implement a simulated LLM query function `queryLLM(systemPrompt, userPrompt)` that accepts an optional API key.
- Fallback to high-fidelity simulated response generator matching E2E scenarios.
- Robust parsing logic to extract facts from the response.
- Commit extracted facts to branch using `memfork.commit`.

## Current Parent
- Conversation ID: 0927b6b5-b20e-46ee-8a4f-b634215b264f
- Updated: 2026-06-19T11:57:00+01:00

## Investigation State
- **Explored paths**:
  - `lib/agents/orchestrator.ts`
  - `tests/e2e/tier4_scenario.test.js`
  - `tests/e2e/tier3_combined.test.js`
  - `lib/db/db.ts`
  - `lib/memory/memfork.ts`
  - `lib/memory/merge.ts`
  - `scripts/mock-memfork.js`
  - `scripts/verify-project.js`
  - `.agents/auditor_m5/handoff.md`
- **Key findings**:
  - The previous Gen 2 code implemented a hardcoded `getMockFacts` within `lib/agents/orchestrator.ts` that directly returned static facts to bypass the Scenario E2E tests, violating the integrity rules of the `benchmark` mode.
  - The user modified `lib/agents/orchestrator.ts` to support standard `llmProvider` hooks and OpenAI POST fetch logic. However, the fallback for empty keys merely returns dummy strings, and the tests bypass the LLM entirely by providing a custom `mockLlmProvider`.
  - Gemini API key support is missing from the live call logic.
  - To restore full benchmark integrity compliance, the `MultiAgentOrchestrator` must run a genuine prompt construction, queryLLM wrapper (with OpenAI & Gemini API client calls), a natural language simulated fallback, and bullet/numbered list parsing with trailing periods stripped.
- **Unexplored areas**: None.

## Key Decisions Made
- Perform static analysis of all modified workspace files to ensure complete compatibility.
- Formulate a detailed refactoring strategy that replaces hardcoded static mock lists in the test files with genuine test flows where the orchestrator uses its internal simulated LLM fallback.
- Design `queryLLM` with support for both `OpenAI` (`https://api.openai.com/v1/chat/completions`) and `Gemini` (`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`) POST endpoints.
- Draft a comprehensive analysis and refactoring strategy report in `analysis.md`.

## Artifact Index
- C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m5_gen3_2\analysis.md — Report and refactoring strategy analysis.
- C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m5_gen3_2\handoff.md — Standard Handoff Protocol report.
