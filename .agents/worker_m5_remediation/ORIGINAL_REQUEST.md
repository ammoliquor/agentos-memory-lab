## 2026-06-19T10:43:46Z
You are a Developer Worker tasked with remediating the Forensic Auditor integrity veto on Milestone 5.
Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\worker_m5_remediation\.

Refactor the codebase according to the following requirements:

1. Refactor `lib/agents/orchestrator.ts`:
   - Write a genuine `MultiAgentOrchestrator` that implements the real multi-agent pipeline:
     - Construct distinct system prompts for the `researcher`, `critic`, and `builder` agents.
     - Before generating, recall branch memory via `memfork recall(branchId)` to feed the historical facts into the LLM prompt.
     - If `process.env.OPENAI_API_KEY` is present, it should use a standard `fetch` call to the OpenAI API endpoint (`https://api.openai.com/v1/chat/completions`) to query the LLM and generate a response.
     - Parse key facts from the LLM output (e.g. lines starting with bullet points `-` or numbers) and commit them to the database using `memfork commit`.
     - Introduce an optional custom `llmProvider` callback/option in the constructor:
       `constructor(apiKey?: string, options?: { llmProvider?: (role: 'researcher' | 'critic' | 'builder', prompt: string, recalledFacts: string[]) => Promise<string[]> })`
     - If `llmProvider` is provided, delegate the LLM call to this provider. If not, fallback to the real OpenAI fetch call. If no key is set and no provider is passed, it can use a simple generic NLP rule or throw an error.
     - Remove all hardcoded scenario facts (like ClickHouse, PostgreSQL, Recharts, D3) from `lib/agents/orchestrator.ts` entirely.

2. Refactor the E2E tests (`tests/e2e/tier3_combined.test.js` and `tests/e2e/tier4_scenario.test.js`):
   - In the tests, instantiate `MultiAgentOrchestrator` by passing a custom mock `llmProvider` in the options that returns the specific facts required by the scenario assertions.
   - This keeps the mock facts inside the test files (where mock data belongs) and keeps the production code `lib/agents/orchestrator.ts` completely clean of hardcoded outputs.

Validation:
- Run `npm run verify` to ensure TypeScript compilation, type checking, and all 51 E2E tests pass successfully.
- Run `npm run build` to verify the Next.js application builds cleanly.
- Report all findings and verification results (including command outputs) in handoff.md in your working directory.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
