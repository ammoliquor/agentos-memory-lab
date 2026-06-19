## 2026-06-19T05:43:43Z
Implement Milestone 3: React Flow DAG & Diff UI.
Create:
1. API endpoints:
   - `app/api/dag/route.ts`
   - `app/api/diff/route.ts`
   - `app/api/merge/route.ts`
2. App Router pages:
   - `app/dag/page.tsx`
3. Interactive components in `components/`:
   - `components/DAGWorkspace.tsx`
   - `components/CommitDAG.tsx`
   - `components/CommitNode.tsx`
   - `components/DiffViewer.tsx`
   - `components/ConflictResolver.tsx`
Please update `components/Sidebar.tsx` to include a link to the Commit Graph (DAG) page `/dag`.
Verify compile with `npm run build`.
