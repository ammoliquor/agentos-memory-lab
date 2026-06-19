# Milestone 2 Handoff Report: Frontend Layout & Chat UI

This handoff report summarizes the read-only exploration and architecture design for implementing Milestone 2: Frontend Layout & Chat UI.

---

## 1. Observation
- **Codebase Directories**: Audited the repository root `C:\Users\USER\antigravitycliproject\memfork`. Found folders `lib/`, `scripts/`, `tests/`, but `app/` and `components/` are entirely missing.
- **Dependency Declared in `package.json`**:
  ```json
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.450.0",
    "reactflow": "^11.10.1"
  }
  ```
  No Tailwind CSS or PostCSS configuration files or dependencies are present in `package.json`.
- **Database Types (`lib/types/index.ts` lines 18-25)**:
  ```typescript
  export interface Message {
    id: string;             // Unique message ID
    branchId: string;       // Associated branch context
    role: 'user' | 'assistant' | 'system';
    content: string;        // Text content
    agentType?: 'researcher' | 'critic' | 'builder' | null; // Agent identifier
    timestamp: number;      // Epoch timestamp (ms)
  }
  ```
- **Agent Orchestrator (`lib/agents/orchestrator.ts` lines 139-143)**:
  ```typescript
  async runParallelPipeline(
    parentBranchId: string,
    prompt: string,
    branchNames?: { researcher?: string; critic?: string; builder?: string }
  ): Promise<{ [role: string]: { branchId: string; commit: Commit } }>
  ```
- **Chat Test Verification (`tests/e2e/tier3_combined.test.js` lines 98-122)**:
  Verifies message synchronization using `addMessage()` and `getMessages()` directly with fields matching the `Message` interface above.

---

## 2. Logic Chain
1. **Next.js & Styling Prerequisites**: Next.js 15 is installed, but `app/` layouts and `components/` do not exist. To proceed, we must first add Tailwind CSS, PostCSS, and autoprefixer as devDependencies, and create their configuration files (`tailwind.config.ts`, `postcss.config.mjs`, and `app/globals.css`).
2. **Active Branch Routing**: To satisfy the "Active branch indicators" requirement, tracking branch context via Next.js App Router dynamic routes `/branch/[branchId]/page.tsx` is highly robust. When rendering the page:
   - The active branch name is fetched from URL parameters.
   - The Sidebar component queries the list of branches via `getBranches()`, loops through them, highlights the active branch using Tailwind CSS active styles, and includes a green indicator dot to mark active status.
3. **Chat Streaming Flow Sync**: To stream the multi-agent execution pipeline:
   - When a user submits a prompt, the UI performs a `POST` request to an SSE route `/api/chat/stream`.
   - The server writes the user message to the JSON DB using `addMessage()`, then executes `orchestrator.runParallelPipeline()`.
   - As each agent finishes, the route handler adds the corresponding assistant message (e.g. `agentType: 'researcher'`) to the database and streams a stringified JSON chunk of the message over SSE.
   - The client-side stream reader receives these events and updates local message state. By inserting them into the database, page refreshes or route changes load the persisted history seamlessly.

---

## 3. Caveats
- **Execution Environment**: We assume a mock or real `memfork` executable is available or simulated (via `scripts/mock-memfork.js`) for tests to execute and database commits to succeed.
- **Streaming Implementation**: Server-Sent Events (SSE) was proposed instead of WebSockets. SSE is lightweight, natively supported in Next.js HTTP streams, and does not require managing socket lifecycle connections.
- **UI Testing**: The proposed React and Tailwind layout code is syntactically sound and aligns with Next.js 15 App router conventions, but has not been tested in a live browser context since this was a read-only investigation.

---

## 4. Conclusion
We have proposed a clean design and file architecture for **Milestone 2** in the `C:\Users\USER\antigravitycliproject\memfork\.agents\explorer_m2_3\analysis.md` report. The proposal includes adding styling dependencies, configuring Tailwind/PostCSS, creating global layout files, setting up a dynamic App Router path `/branch/[branchId]`, developing components (`Sidebar`, `ForkModal`, `ChatContainer`, `ChatMessage`, `ActiveBranchHeader`), and implementing a dynamic SSE API handler (`/api/chat/stream/route.ts`) to manage active branch selection and real-time multi-agent chat synchronization.

---

## 5. Verification Method
- **Inspection of Files**: Verify that the files outlined in `analysis.md` match the target architecture directory structure.
- **Type Checking and E2E Tests**: Verify that the project types and tests pass cleanly by running:
  ```powershell
  npm run verify
  ```
- **SSE Stream Verification**: Verify that a `POST` request to `/api/chat/stream` streams standard event-stream chunks:
  ```
  event: message
  data: {"id":"...","branchId":"main","role":"assistant","agentType":"researcher","content":"...","timestamp":...}
  ```
