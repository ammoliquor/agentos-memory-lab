# Scope: Development & Integration Track (M1-M5)

## Architecture
- Framework: Next.js 15 App Router, React 19, Tailwind CSS, shadcn/ui.
- Libraries: `lucide-react`, `reactflow` for DAG.
- Target entry points:
  - `lib/db/db.ts` - Local database
  - `lib/memory/memfork.ts` - CLI child_process execution
  - `lib/memory/merge.ts` - Fact diffing and contradiction resolution
  - `lib/agents/orchestrator.ts` - Researcher, Critic, Builder agents
  - `app/page.tsx` - App Layout and dashboard
  - `actions/` - Next.js Server Actions connecting the UI to `lib/`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | Backend Verification | Run and verify the backend modules M1, M2, M3 against E2E tests | None | DONE (266e45c8-0912-4387-b74c-bcf0d46d18dc) |
| 2 | Frontend Layout & Chat UI | Main sidebar layout, active branch indicators, chat streaming UI | 1 | DONE (fcd7d0a3-c86a-4764-a668-f6739158ddd3) |
| 3 | React Flow DAG & Diff UI | Interactive graph visualization of commits, side-by-side Diff viewer | 2 | DONE (0799a831-88a0-4050-869f-107f9040081f) |
| 4 | Server Actions Integration | Integrate Next.js API/actions with DB persistence and agent pipelines | 3 | DONE (actions_integration) |
| 5 | E2E Verification & Polish | Verify the full suite via `npm run verify`, ensure build compile clean | 4 | IN_PROGRESS (e2e_runner_polish) |
