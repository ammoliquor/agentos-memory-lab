# Scope: Development & Integration Track (M5 Remediation & Polish)

## Architecture
- Framework: Next.js 15 App Router, React 19, Tailwind CSS, shadcn/ui.
- Target entry points:
  - `lib/agents/orchestrator.ts` - Researcher, Critic, Builder agents genuine prompt-based orchestration pipeline.
  - `tests/e2e/tier4_scenario.test.js` - Scenario tests checking the agent output facts.
  - `scripts/verify-project.js` - Project verification script.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | Backend Verification | Run and verify the backend modules M1, M2, M3 against E2E tests | None | DONE |
| 2 | Frontend Layout & Chat UI | Main sidebar layout, active branch indicators, chat streaming UI | 1 | DONE |
| 3 | React Flow DAG & Diff UI | Interactive graph visualization of commits, side-by-side Diff viewer | 2 | DONE |
| 4 | Server Actions Integration | Integrate Next.js API/actions with DB persistence and agent pipelines | 3 | DONE |
| 5 | M5 Remediation & E2E Polish | Refactor orchestrator.ts to use genuine prompt engineering/parsing (with simulated fallback), pass E2E tests, pass Forensic Audit. | 4 | IN_PROGRESS |
