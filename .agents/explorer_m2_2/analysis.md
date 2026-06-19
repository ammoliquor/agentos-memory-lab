# Milestone 2: Frontend Layout & Chat UI - Analysis & Architecture Projections

This document presents a comprehensive, read-only analysis of the current frontend setup of the **AgentOS Memory Lab** project, identifies missing files/dependencies, and proposes a complete architecture and design mockups for Milestone 2.

---

## 1. Executive Summary

- **Current State**: The project is a TypeScript Next.js 15 App Router codebase. However, there are no files in the `app/` directory (routes, page, layout) or `components/` directory. No CSS configuration or styles exist.
- **Dependencies**: The `package.json` includes `next`, `react` (v19), `react-dom` (v19), `lucide-react` (icons), and `reactflow` (DAG rendering), but **lacks Tailwind CSS and PostCSS dependencies**.
- **Proposed Architecture**:
  - **Styles**: Add `tailwindcss`, `postcss`, and `autoprefixer` to `package.json`. Add standard Tailwind configs.
  - **Layout**: Implement a grid layout with a Sidebar on the left (showing branches, active branch indicators, fork/create actions) and Main Content on the right (split into Chat UI and Fact Inspector).
  - **Sync & Streaming**: Leverage Next.js Route Handlers to orchestrate chat workflows, poll or stream responses via Server-Sent Events (SSE), and write agent actions directly to the local JSON database (`lib/db/db.ts`) for branch-isolated message histories.

---

## 2. Directory Layout & Existing Codebase Analysis

### File Structure Observations
Through recursive exploration, we confirmed the workspace contains the following files:
- **Core Library & Wrappers**:
  - `lib/types/index.ts`: Defines interfaces for `Branch`, `Commit`, `Message`, `Conflict`, `MergeProposal`, and `DatabaseSchema`.
  - `lib/db/db.ts`: Handles JSON database CRUD, atomic updates with `.lock` file concurrency protection.
  - `lib/memory/memfork.ts`: Wraps the `memfork` executable using `child_process.spawn`.
  - `lib/memory/merge.ts`: Classifies fact diffs, detects technology/semantic conflicts, and merges branches.
  - `lib/agents/orchestrator.ts`: Runs parallel forks and manages agent execution (Researcher, Critic, Builder).
- **Scripts & Verification**:
  - `scripts/verify-project.js` / `scripts/run-e2e.js`: Verifies TS and runs node test suites (Tiers 1-4).
- **Frontend Assets**:
  - **No `app/` directory** containing page layouts or routing exists.
  - **No `components/` directory** containing reusable React components exists.
  - **No Tailwind CSS or PostCSS configuration files** exist in the workspace root.

### Dependencies in `package.json`
```json
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.450.0",
    "reactflow": "^11.10.1"
  }
```
*Note: Tailwind CSS is not present. It must be added to enable the utility-first CSS styling expected in shadcn/ui architectures.*

---

## 3. Milestone 2 Proposal: Frontend Layout & Chat UI

### 3.1 Styling & Tailwind Setup (Dark Mode)
We propose installing the following devDependencies:
- `tailwindcss@^3.4.0` or `tailwindcss@^4.0.0`
- `postcss@^8.0.0`
- `autoprefixer@^10.0.0`

#### Proposed `tailwind.config.ts`
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        border: "hsl(var(--border))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
      },
    },
  },
  plugins: [],
};
export default config;
```

#### Proposed `app/globals.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 224 71% 4%;
    --foreground: 210 20% 98%;
    --card: 224 71% 4%;
    --border: 217.2 32.6% 17.5%;
    --primary: 263.4 70% 50.4%;
    --primary-foreground: 210 20% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
  }
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow-hidden;
}
```

---

### 3.2 Layout & Active Branch Indicator Architecture

The UI should adopt a grid layout optimized for dark mode (using deep slates and indigo accents):
1. **Left Sidebar (280px)**:
   - **Branch Selection Panel**: List of branches retrieved from `lib/db/db.ts` (`getBranches()`).
   - **Active Branch Indicator**: A glowing green dot and colored label highlighting the currently active branch.
   - **Lineage Navigation**: Subtle lines showing parent-child relationships (e.g. `main` -> `research-agent`).
   - **Fork Button**: Quick dialog input to create a new branch from the active branch using the `branch()` wrapper.
2. **Main Workspace**:
   - **Header**: Displays the active branch name, commit count, and recalled facts count. Includes a branch toggle.
   - **Split Pane Layout**:
     - **Left Pane (60%) - Chat & Orchestration**: Active conversation interface. Syncs with database messages.
     - **Right Pane (40%) - Memory Inspector**: Real-time display of recalled facts (`recall(branchId)`) and the linear commit history (`getCommits(branchId)`).

---

### 3.3 Chat Streaming & Sync Architecture

To allow interactive multi-agent chat without blocking, we propose a Route Handler + Polling or SSE framework:

#### 1. Message Sync Flow
```
[User Input] ──► POST /api/chat ──► (Save User Message to DB)
                                         │
                                         ├──► If Orchestrate: Fork 3 branches + Trigger MultiAgentOrchestrator
                                         │    └─► Spawns Parallel Pipelines & Commits Facts
                                         │
                                         └──► Response containing user message + Agent trigger ID
```
- The client app retrieves message histories using `GET /api/messages?branchId=[activeBranch]`.
- During active pipeline execution, the frontend polls `/api/messages` or subscribes to a Server-Sent Events stream to render typing indicators and agent outputs incrementally.
- Agent outputs are written directly to the database as assistant messages with the respective `agentType` (`researcher` | `critic` | `builder`), making it easy to style them differently.

---

## 4. Code Projections / Implementation Sketch

Below are implementation projections for key files to implement Milestone 2.

### 4.1 Root Layout: `app/layout.tsx`
Provides the HTML structure, global CSS imports, and metadata configurations.
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentOS Memory Lab",
  description: "Interactive multi-agent memory branching playground",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0b0f19] text-gray-100 antialiased h-screen overflow-hidden">
        {children}
      </body>
    </html>
  );
}
```

### 4.2 API Endpoint: `app/api/chat/route.ts`
Receives user prompts, saves them to the DB, and launches the multi-agent orchestration sequence.
```typescript
import { NextResponse } from "next/server";
import { addMessage } from "@/lib/db/db";
import { MultiAgentOrchestrator } from "@/lib/agents/orchestrator";
import * as crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { branchId, content, orchestrate } = await req.json();

    if (!branchId || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Add user message to active branch database context
    const userMsg = {
      id: "msg_" + crypto.randomUUID().replace(/-/g, "").substring(0, 12),
      branchId,
      role: "user" as const,
      content,
      timestamp: Date.now(),
    };
    await addMessage(userMsg);

    if (orchestrate) {
      // 2. Perform parallel agent pipelines asynchronously
      const orchestrator = new MultiAgentOrchestrator();
      
      // We start this asynchronously and let the DB updates stream in
      const pipelinePromise = orchestrator.runParallelPipeline(branchId, content, {
        researcher: `research-${Date.now()}`,
        critic: `critic-${Date.now()}`,
        builder: `builder-${Date.now()}`,
      }).then(async (pipeline) => {
        // Once done, append summaries of agent findings to messages DB
        await addMessage({
          id: "msg_" + crypto.randomUUID().replace(/-/g, "").substring(0, 12),
          branchId,
          role: "assistant",
          agentType: "researcher",
          content: `Researcher forked branch and committed: ${pipeline.researcher.commit.facts.join(", ")}`,
          timestamp: Date.now(),
        });
        await addMessage({
          id: "msg_" + crypto.randomUUID().replace(/-/g, "").substring(0, 12),
          branchId,
          role: "assistant",
          agentType: "critic",
          content: `Critic forked branch and committed: ${pipeline.critic.commit.facts.join(", ")}`,
          timestamp: Date.now(),
        });
        await addMessage({
          id: "msg_" + crypto.randomUUID().replace(/-/g, "").substring(0, 12),
          branchId,
          role: "assistant",
          agentType: "builder",
          content: `Builder forked branch and committed: ${pipeline.builder.commit.facts.join(", ")}`,
          timestamp: Date.now(),
        });
      }).catch(console.error);
    }

    return NextResponse.json({ success: true, userMessage: userMsg });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

### 4.3 Sidebar Component: `components/Sidebar.tsx`
Renders the branch selection panel, active state, and branch creation trigger.
```tsx
"use client";

import { useState } from "react";
import { GitBranch, Plus, Compass, MessageSquare } from "lucide-react";
import { Branch } from "@/lib/types";

interface SidebarProps {
  branches: Branch[];
  activeBranchId: string;
  onSelectBranch: (id: string) => void;
  onCreateBranch: (name: string, parentId: string) => Promise<void>;
}

export default function Sidebar({
  branches,
  activeBranchId,
  onSelectBranch,
  onCreateBranch,
}: SidebarProps) {
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    try {
      await onCreateBranch(newBranchName.trim(), activeBranchId);
      setNewBranchName("");
      setIsCreating(false);
    } catch (err: any) {
      alert(err.message || "Failed to create branch");
    }
  };

  return (
    <div className="w-72 bg-[#0e1322] border-r border-[#1e293b] flex flex-col h-full">
      <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="w-6 h-6 text-indigo-500" />
          <h1 className="font-bold text-lg text-white">Memory Lab</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase text-gray-500 tracking-wider">
              Branches
            </span>
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="text-gray-400 hover:text-indigo-400 p-0.5 rounded"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {isCreating && (
            <form onSubmit={handleCreate} className="mb-3">
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="Branch name..."
                className="w-full bg-[#1b2336] text-sm text-gray-200 border border-[#2e3b56] rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
            </form>
          )}

          <div className="space-y-1">
            {branches.map((b) => {
              const isActive = b.id === activeBranchId;
              return (
                <button
                  key={b.id}
                  onClick={() => onSelectBranch(b.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors ${
                    isActive
                      ? "bg-indigo-600/20 text-indigo-300 font-medium"
                      : "text-gray-400 hover:bg-[#161d30] hover:text-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <GitBranch className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{b.name}</span>
                  </div>
                  {isActive && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 4.4 Main Page Playground: `app/page.tsx`
Assembles the components, manages react state, and handles API coordination.
```tsx
"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { Branch, Message } from "@/lib/types";

export default function Page() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState("main");
  const [messages, setMessages] = useState<Message[]>([]);
  const [recalledFacts, setRecalledFacts] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [orchestrated, setOrchestrated] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch branches, messages, and recalled facts on load or branch switch
  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchBranchContext(activeBranchId);
    // Setup polling for updates during orchestrator execution
    const interval = setInterval(() => {
      fetchBranchContext(activeBranchId);
    }, 3000);
    return () => clearInterval(interval);
  }, [activeBranchId]);

  const fetchBranches = async () => {
    const res = await fetch("/api/branches");
    const data = await res.json();
    if (data.branches) setBranches(data.branches);
  };

  const fetchBranchContext = async (branchId: string) => {
    const [msgRes, factRes] = await Promise.all([
      fetch(`/api/messages?branchId=${branchId}`),
      fetch(`/api/recall?branchId=${branchId}`),
    ]);
    const msgData = await msgRes.json();
    const factData = await factRes.json();
    if (msgData.messages) setMessages(msgData.messages);
    if (factData.facts) setRecalledFacts(factData.facts);
  };

  const handleSelectBranch = (id: string) => {
    setActiveBranchId(id);
  };

  const handleCreateBranch = async (name: string, parentId: string) => {
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    if (res.ok) {
      await fetchBranches();
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    const contentToSend = prompt;
    setPrompt("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: activeBranchId,
          content: contentToSend,
          orchestrate: orchestrated,
        }),
      });
      if (res.ok) {
        await fetchBranchContext(activeBranchId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        branches={branches}
        activeBranchId={activeBranchId}
        onSelectBranch={handleSelectBranch}
        onCreateBranch={handleCreateBranch}
      />
      
      {/* Main Panel */}
      <div className="flex-1 flex flex-col h-full bg-[#0b0f19]">
        {/* Header */}
        <header className="h-16 border-b border-[#1e293b] flex items-center justify-between px-6 bg-[#0e1322]">
          <div>
            <h2 className="font-bold text-white flex items-center gap-2">
              Branch: <span className="text-indigo-400">{activeBranchId}</span>
            </h2>
          </div>
        </header>

        {/* Workspace Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat Pane */}
          <div className="w-[60%] flex flex-col h-full border-r border-[#1e293b]">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col max-w-[85%] rounded-lg p-3 ${
                    m.role === "user"
                      ? "ml-auto bg-indigo-600 text-white"
                      : "bg-[#141b2e] border border-[#232e49] text-gray-200"
                  }`}
                >
                  {m.agentType && (
                    <span className="text-xs font-semibold text-indigo-400 mb-1 uppercase tracking-wider">
                      {m.agentType} agent
                    </span>
                  )}
                  <p className="text-sm leading-relaxed">{m.content}</p>
                  <span className="text-[10px] text-gray-400 mt-1 self-end">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Input Form */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-[#1e293b] bg-[#0e1322]">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask a question or input design facts..."
                  className="flex-1 bg-[#1b2336] text-gray-200 border border-[#2e3b56] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-indigo-500"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={orchestrated}
                    onChange={(e) => setOrchestrated(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  Run parallel agent pipeline (Researcher, Critic, Builder)
                </label>
              </div>
            </form>
          </div>

          {/* Facts Inspector Pane */}
          <div className="w-[40%] bg-[#0c101d] flex flex-col h-full overflow-y-auto p-6">
            <h3 className="text-sm font-semibold uppercase text-gray-500 tracking-wider mb-4">
              Recalled Design Facts
            </h3>
            {recalledFacts.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-[#232e49] rounded-lg p-6 text-gray-500 text-sm">
                No facts asserted on this branch yet.
              </div>
            ) : (
              <div className="space-y-2">
                {recalledFacts.map((fact, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-[#131929] border border-[#202b44] rounded-lg text-sm text-gray-300 flex items-start gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                    <span>{fact}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 5. Architectural Verification & Verification Plan

### Test & Build Checks
To verify this setup, subsequent implementers must perform:
1. **Dependencies installation**: Run `npm install` after editing `package.json`.
2. **Compile-time validation**: Execute `npm run build` or `npx tsc --noEmit` to ensure Next.js 15 pages compile cleanly and resolve JSX elements correctly.
3. **Execution integration checks**: Run `node scripts/verify-project.js` to ensure the core database tests continue to pass and are not broken by the new pages or layout components.
