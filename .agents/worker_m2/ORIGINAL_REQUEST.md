## 2026-06-19T02:38:26Z
You are a worker agent. Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\worker_m2.
Your goal is to implement Milestone 2: Frontend Layout & Chat UI.
You need to:
1. Install Tailwind CSS and CSS utility dependencies:
   `npm install -D tailwindcss@^3.4.1 postcss@^8.4.0 autoprefixer@^10.4.0 tailwind-merge clsx class-variance-authority`
   Please run the npm install command to install these dependencies.
2. Create standard config files at project root:
   - `postcss.config.mjs`
   - `tailwind.config.ts`
   - `next.config.js`
3. Create CSS stylesheet at `app/globals.css`.
4. Create global utils class merger at `lib/utils.ts`.
5. Create App Router page layouts and routes:
   - `app/layout.tsx` (base HTML layout with globals.css imported)
   - `app/page.tsx` (default page, redirect to `/branch/main` using redirect from next/navigation)
   - `app/branch/[branchId]/page.tsx` (active branch layout, reads initial messages and branch list, renders Sidebar + Header + ChatContainer)
6. Create API endpoints:
   - `app/api/chat/stream/route.ts` (accepts user message, uses SSE stream to run the MultiAgentOrchestrator parallel pipeline, records messages in database, and streams events: status, message, error)
   - `app/api/branch/route.ts` (accepts name and from, creates a branch using the branch function from lib/memory/memfork.ts)
7. Create interactive UI components in `components/`:
   - `components/Sidebar.tsx` (renders branch list, active branch indicator dot, and triggers ForkModal)
   - `components/ForkModal.tsx` (renders overlays dialog for branch naming, calls POST /api/branch, refreshes router, and redirects user)
   - `components/ActiveBranchHeader.tsx` (renders branch title and parent information)
   - `components/ChatContainer.tsx` (manages chat messages list state, loading states, SSE fetch reading stream, and layout scroll behavior)
   - `components/ChatMessage.tsx` (renders chat cards styled differently for User, Researcher, Critic, Builder agents with icons)

Make sure Next.js type checking and builds succeed by running `npm run build` after implementing.
Report any typescript or compilation errors and fix them.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
