# Milestone 2 Analysis Report: Frontend Layout & Chat UI

This analysis outlines the frontend state, details the necessary Tailwind CSS configurations, and provides a comprehensive architectural proposal for implementing **Milestone 2: Frontend Layout & Chat UI** within the **AgentOS Memory Lab** project.

---

## 1. Current Codebase Audit

### 1.1 Folder Structures and Boilerplates
A filesystem scan was performed on the root directory `C:\Users\USER\antigravitycliproject\memfork`. The following directories and files were found:
- **Existing Directories**:
  - `lib/` (Contains core logic: `lib/db/db.ts`, `lib/agents/orchestrator.ts`, `lib/memory/memfork.ts`, `lib/memory/merge.ts`, `lib/types/index.ts`)
  - `scripts/` (Verification, mock, and runner scripts)
  - `tests/` (Integration test suites)
- **Non-existent Directories**:
  - `app/` (Next.js App Router directories/files are entirely absent)
  - `components/` (React UI components are entirely absent)
  - `actions/` (Next.js Server Actions are entirely absent)
  - `hooks/` (React hooks are entirely absent)

### 1.2 Configuration Files
- **TypeScript**: `tsconfig.json` exists and defines a path alias mapping:
  ```json
  "paths": {
    "@/*": ["./*"]
  }
  ```
  This allows clean, absolute-like imports (e.g., `import { db } from '@/lib/db/db'`).
- **Styles / Tailwind**:
  - No `tailwind.config.ts` or `tailwind.config.js` exists.
  - No `postcss.config.js` or `postcss.config.mjs` exists.
  - No CSS style sheet files (`.css`) exist in the project directory.

### 1.3 `package.json` Dependencies
The dependencies currently installed include:
- `next`: `^15.0.0`
- `react`: `^19.0.0`
- `react-dom`: `^19.0.0`
- `lucide-react`: `^0.450.0` (Icon library)
- `reactflow`: `^11.10.1` (DAG visualization)

*Observation*: Tailwind CSS dependencies (`tailwindcss`, `postcss`, `autoprefixer`) and utility libraries (`clsx`, `tailwind-merge`, `class-variance-authority`) are **not** present in `package.json`. These must be installed to support styled layout development.

---

## 2. Configuration Setup Proposal

To support a Tailwind CSS styled project using React 19 and Next.js 15, we propose installing the necessary libraries and establishing standard config files.

### 2.1 Dependencies to Add
Run the following install command in the workspace:
```bash
npm install -D tailwindcss@^3.4.1 postcss@^8.4.0 autoprefixer@^10.4.0 tailwind-merge clsx class-variance-authority
```

### 2.2 PostCSS Config (`postcss.config.mjs`)
Create in root `C:\Users\USER\antigravitycliproject\memfork\postcss.config.mjs`:
```javascript
const postcssConfig = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
export default postcssConfig;
```

### 2.3 Tailwind Config (`tailwind.config.ts`)
Create in root `C:\Users\USER\antigravitycliproject\memfork\tailwind.config.ts`:
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        accent: {
          user: "#8b5cf6", // Purple
          researcher: "#3b82f6", // Blue
          critic: "#f97316", // Orange
          builder: "#22c55e", // Green
        }
      },
    },
  },
  plugins: [],
};
export default config;
```

### 2.4 Global Stylesheet (`app/globals.css`)
Create `app/globals.css` with CSS variables implementing the Modern Dark Theme:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: #09090b; /* Zinc 950 */
    --foreground: #fafafa; /* Zinc 50 */
    --card: #18181b; /* Zinc 900 */
    --card-foreground: #fafafa;
    --border: #27272a; /* Zinc 800 */
  }
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
}

/* Custom Scrollbars */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
}
```

---

## 3. Proposed UI/UX Layout Design

The user interface should support a dark mode desktop workstation tailored for system engineers and developers exploring memory forks.

```
┌────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (Dark Mode 240px)  │           MAIN CHAT VIEW                 │
│                             │                                          │
│  [Logo] AgentOS Memory Lab  │  ┌────────────────────────────────────┐  │
│                             │  │ Active Branch: [feature-a]      ●  │  │
│  BRANCHES                   │  └────────────────────────────────────┘  │
│  - main                     │  ┌────────────────────────────────────┐  │
│  - feature-a  <-- Active    │  │ [Research Agent]                   │  │
│  - research-1               │  │ Facts:                             │  │
│  - critic-1                 │  │ * Use WebSockets for real-time     │  │
│                             │  ├────────────────────────────────────┤  │
│  ┌───────────────────────┐  │  │ [Critic Agent]                     │  │
│  │ [Button] Fork Branch  │  │  │ Weaknesses:                        │  │
│  └───────────────────────┘  │  │ * Increases connection overhead    │  │
│                             │  ├────────────────────────────────────┤  │
│  [User Footer]              │  │ [User]                             │  │
│                             │  │ What cache strategy is suggested?  │  │
│                             │  └────────────────────────────────────┘  │
│                             │  ┌────────────────────────────────────┐  │
│                             │  │ [ Input message...             ]   │  │
│                             │  └────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Sidebar Component Features
- **List of Branches**: Fetched from `lib/db/db.ts` -> `getBranches()`. Renders a hierarchy or chronological list.
- **Active Branch Indicator**: Highlighting the branch matching the current dynamic path or state. An active branch displays with a background indicator, active border accent, and a green status indicator dot.
- **Branch Action Fork Modal**: Clicking "Fork Branch" triggers a simple overlay dialog requesting a new branch name. On submit, it calls the `branch` Server Action/API and redirects to the new branch route.

### 3.2 Chat Feed Bubble Accents
Messages are styled dynamically based on the actor (`role` and `agentType`):
- **User**: Solid Dark Purple background (`bg-indigo-950/40 border border-indigo-700/50`), aligned right.
- **Research Agent**: Blue layout accent (`border-l-4 border-blue-500 bg-blue-950/20`), displaying a structured bulleted facts list.
- **Critic Agent**: Orange/Amber layout accent (`border-l-4 border-orange-500 bg-orange-950/20`), listing weaknesses, risks, and contradictions.
- **Builder Agent**: Green layout accent (`border-l-4 border-green-500 bg-green-950/20`), providing concrete recommendations.

---

## 4. Architectural blueprints (app/ and components/)

### 4.1 Proposed Frontend Layout File Structure
The following folder layout should be established inside the project root:
```
C:\Users\USER\antigravitycliproject\memfork/
├── app/
│   ├── globals.css              # Stylesheet config
│   ├── layout.tsx               # Base layout, wrapper
│   ├── page.tsx                 # Default page (redirects to /branch/main)
│   ├── branch/
│   │   └── [branchId]/
│   │       └── page.tsx         # Active branch page: Sidebar + Chat UI
│   └── api/
│       └── chat/
│           └── stream/
│               └── route.ts     # SSE stream handler executing parallel orchestration
├── components/
│   ├── Sidebar.tsx              # Branch rendering and branching trigger
│   ├── ForkModal.tsx            # Modal for branch creation
│   ├── ChatContainer.tsx        # Scrollable chat feed container
│   ├── ChatMessage.tsx          # Card rendering individual message details
│   └── ActiveBranchHeader.tsx   # Top navigation displaying active branch state
└── lib/
    └── utils.ts                 # Utility helpers: cn() class mergers
```

### 4.2 Detailed Component Code Outlines

#### A. Global CSS Helper (`lib/utils.ts`)
```typescript
import { type ClassValue, clsx } from "clsx";
import { tailwindMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return tailwindMerge(clsx(inputs));
}
```

#### B. Dynamic SSE Chat Handler (`app/api/chat/stream/route.ts`)
This API endpoint accepts the user prompt, inserts the user message into the database, initializes the `MultiAgentOrchestrator`, triggers the parallel execution pipeline, writes the resulting agent responses to the DB, and streams the updates to the frontend via SSE.
```typescript
import { NextRequest } from "next/server";
import { addMessage } from "@/lib/db/db";
import { MultiAgentOrchestrator } from "@/lib/agents/orchestrator";
import { Message } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { message, branchId } = await req.json();

  if (!message || !branchId) {
    return new Response("Missing message or branchId", { status: 400 });
  }

  // Create SSE pipeline
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

        // Run the agent pipeline in parallel (as implemented in orchestrator.ts)
        const pipeline = await orchestrator.runParallelPipeline(branchId, message, subBranchNames);

        // 3. Process and stream Researcher Agent output
        const researcherFact = pipeline.researcher.commit.facts.join(", ") || "No researcher facts gathered.";
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
        sendEvent("error", { message: err.message });
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
}
```

#### C. Root Layout (`app/layout.tsx`)
```typescript
import "./globals.css";

export const metadata = {
  title: "AgentOS Memory Lab",
  description: "Branching memory state explorer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen w-screen bg-[#09090b] text-[#fafafa] flex overflow-hidden">
        {children}
      </body>
    </html>
  );
}
```

#### D. Dynamic Branch Layout with Active Indicators (`app/branch/[branchId]/page.tsx`)
This handles loading active branches and displaying them on-screen.
```typescript
import { getBranches, getMessages } from "@/lib/db/db";
import Sidebar from "@/components/Sidebar";
import ChatContainer from "@/components/ChatContainer";
import ActiveBranchHeader from "@/components/ActiveBranchHeader";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ branchId: string }>;
}

export default async function BranchPage({ params }: PageProps) {
  const { branchId } = await params;
  const branches = await getBranches();
  
  // Verify branch validity
  const activeBranch = branches.find((b) => b.id === branchId);
  if (!activeBranch && branchId !== "main") {
    notFound();
  }

  // Fetch conversations associated with the branch
  const initialMessages = await getMessages(branchId);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar - lists branches and highlights the active branch */}
      <Sidebar branches={branches} activeBranchId={branchId} />
      
      {/* Workspace Area */}
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#09090b]">
        <ActiveBranchHeader branch={activeBranch || { id: "main", name: "main", parentBranchId: null }} />
        <ChatContainer branchId={branchId} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
```

#### E. Sidebar Component (`components/Sidebar.tsx`)
```typescript
"use client";

import Link from "next/link";
import { Branch } from "@/lib/types";
import { GitBranch, Plus, Database } from "lucide-react";
import { useState } from "react";
import ForkModal from "./ForkModal";

interface SidebarProps {
  branches: Branch[];
  activeBranchId: string;
}

export default function Sidebar({ branches, activeBranchId }: SidebarProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <aside className="w-64 bg-[#18181b] border-r border-[#27272a] flex flex-col h-full select-none">
      {/* App Branding Header */}
      <div className="p-4 border-b border-[#27272a] flex items-center space-x-2">
        <Database className="w-5 h-5 text-indigo-500" />
        <span className="font-semibold text-sm tracking-tight text-white">AgentOS Memory Lab</span>
      </div>

      {/* Navigation Headers and Actions */}
      <div className="p-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 tracking-wider uppercase">Memory Branches</span>
        <button
          onClick={() => setIsModalOpen(true)}
          className="p-1 hover:bg-[#27272a] rounded transition-colors text-zinc-400 hover:text-white"
          title="Fork active branch"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Branch List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {branches.map((b) => {
          const isActive = b.id === activeBranchId;
          return (
            <Link
              key={b.id}
              href={`/branch/${b.id}`}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-md text-sm transition-all group ${
                isActive
                  ? "bg-zinc-800 text-white font-medium shadow-inner"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <GitBranch className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-zinc-500"}`} />
              <span className="truncate flex-1">{b.name}</span>
              {isActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-950" title="Active Context" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Action Dialog / Modal */}
      {isModalOpen && (
        <ForkModal
          parentBranchId={activeBranchId}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-[#27272a] text-xs text-zinc-500">
        Workspace: <span className="font-mono text-zinc-300">memfork-lab</span>
      </div>
    </aside>
  );
}
```

#### F. Fork Modal Component (`components/ForkModal.tsx`)
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, X } from "lucide-react";

interface ForkModalProps {
  parentBranchId: string;
  onClose: () => void;
}

export default function ForkModal({ parentBranchId, onClose }: ForkModalProps) {
  const router = useRouter();
  const [branchName, setBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      // Create branch through an API route (or Server Action equivalent)
      const res = await fetch("/api/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: branchName, from: parentBranchId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to fork branch");
      }

      router.refresh();
      router.push(`/branch/${branchName}`);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
          <span className="flex items-center gap-2 font-medium text-sm text-white">
            <GitBranch className="w-4 h-4 text-indigo-400" />
            Fork Branch: {parentBranchId}
          </span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
              New Branch Name
            </label>
            <input
              type="text"
              autoFocus
              required
              disabled={isLoading}
              placeholder="e.g. feature-query-cache"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="w-full bg-zinc-900 border border-[#27272a] rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}

          <div className="flex justify-end gap-2 text-sm pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-3 py-2 bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50"
            >
              {isLoading ? "Forking..." : "Fork Branch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

#### G. Chat Message Component (`components/ChatMessage.tsx`)
```typescript
import { Message } from "@/lib/types";
import { User, ShieldAlert, Cpu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const { agentType } = message;

  // Compute themes and icons
  let title = "User";
  let icon = <User className="w-3.5 h-3.5" />;
  let cardClass = "bg-zinc-900/50 border-zinc-800/80 text-zinc-200 self-start";
  let badgeClass = "bg-zinc-800 text-zinc-400";

  if (isUser) {
    cardClass = "bg-indigo-950/20 border-indigo-500/30 text-indigo-100 self-end ml-12";
    badgeClass = "bg-indigo-900/40 text-indigo-300";
  } else if (agentType === "researcher") {
    title = "Researcher Agent";
    icon = <Sparkles className="w-3.5 h-3.5" />;
    cardClass = "bg-blue-950/20 border-blue-500/30 text-blue-100 self-start mr-12 border-l-4 border-l-blue-500";
    badgeClass = "bg-blue-900/40 text-blue-300";
  } else if (agentType === "critic") {
    title = "Critic Agent";
    icon = <ShieldAlert className="w-3.5 h-3.5" />;
    cardClass = "bg-orange-950/20 border-orange-500/30 text-orange-100 self-start mr-12 border-l-4 border-l-orange-500";
    badgeClass = "bg-orange-900/40 text-orange-300";
  } else if (agentType === "builder") {
    title = "Builder Agent";
    icon = <Cpu className="w-3.5 h-3.5" />;
    cardClass = "bg-emerald-950/20 border-emerald-500/30 text-emerald-100 self-start mr-12 border-l-4 border-l-emerald-500";
    badgeClass = "bg-emerald-900/40 text-emerald-300";
  }

  return (
    <div className={cn("flex flex-col max-w-[85%] rounded-lg p-4 border transition-all shadow-sm", cardClass)}>
      {/* Card Header Tag */}
      <div className="flex items-center space-x-1.5 mb-2.5">
        <span className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", badgeClass)}>
          {icon}
          {title}
        </span>
        <span className="text-[10px] text-zinc-500">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Message Content */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap font-sans text-zinc-300">
        {message.content}
      </div>
    </div>
  );
}
```

#### H. Active Branch Header (`components/ActiveBranchHeader.tsx`)
```typescript
import { Branch } from "@/lib/types";
import { GitBranch, GitFork } from "lucide-react";

interface HeaderProps {
  branch: Branch;
}

export default function ActiveBranchHeader({ branch }: HeaderProps) {
  return (
    <header className="h-14 border-b border-[#27272a] bg-[#18181b]/30 flex items-center justify-between px-6">
      {/* Title */}
      <div className="flex items-center space-x-3">
        <GitBranch className="w-5 h-5 text-indigo-400" />
        <h1 className="text-sm font-semibold text-white tracking-tight">{branch.name}</h1>
        {branch.parentBranchId && (
          <div className="flex items-center space-x-1 text-xs text-zinc-500">
            <span>branched from</span>
            <GitFork className="w-3 h-3" />
            <span className="font-mono text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-[#27272a]">
              {branch.parentBranchId}
            </span>
          </div>
        )}
      </div>

      {/* State Badge */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-zinc-400 font-medium">Head Connected</span>
      </div>
    </header>
  );
}
```

#### I. Chat Container Component (`components/ChatContainer.tsx`)
This coordinates the streaming sync behavior, submitting requests to the dynamic route, reading the SSE response stream, parsing JSON chunks, and updating UI states in real-time.
```typescript
"use client";

import { Message } from "@/lib/types";
import { useState, useRef, useEffect } from "react";
import ChatMessage from "./ChatMessage";
import { Send, Loader } from "lucide-react";

interface ChatProps {
  branchId: string;
  initialMessages: Message[];
}

export default function ChatContainer({ branchId, initialMessages }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const prompt = input;
    setInput("");
    setIsLoading(true);
    setStatusText("Initializing orchestrator...");

    try {
      // Initiate SSE streaming request
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, branchId }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Parse event stream formats
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || ""; // Retain incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse SSE fields
          const eventMatch = line.match(/^event: (.+)$/m);
          const dataMatch = line.match(/^data: (.+)$/m);

          if (dataMatch) {
            const event = eventMatch ? eventMatch[1] : "message";
            const rawData = dataMatch[1];
            const parsedData = JSON.parse(rawData);

            if (event === "message") {
              const msg = parsedData as Message;
              // Append to list, filtering out user duplicate if client-rendered
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
            } else if (event === "status") {
              if (parsedData.state === "orchestrating") {
                setStatusText("Running parallel agent forks (Researcher, Critic, Builder)...");
              } else if (parsedData.state === "done") {
                setStatusText("");
              }
            } else if (event === "error") {
              console.error("Stream error: ", parsedData.message);
              setStatusText(`Error: ${parsedData.message}`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      setStatusText(`Connection failed: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusText("");
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Scrollable Message Flow */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 space-y-2 select-none">
            <Send className="w-8 h-8 text-zinc-600 rotate-45" />
            <p className="text-sm">Initiate multi-agent pipeline by sending a prompt</p>
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}
        
        {/* Loading / Status Streaming Panel */}
        {isLoading && (
          <div className="flex items-center space-x-2.5 p-3 rounded-lg border border-[#27272a] bg-[#18181b]/50 text-xs text-zinc-400 self-start mr-12">
            <Loader className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            <span>{statusText || "Waiting for agent responses..."}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Form Footer */}
      <div className="p-4 border-t border-[#27272a] bg-[#18181b]/10">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            disabled={isLoading}
            placeholder="Ask agent orchestrator to plan, criticize, or research designs..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-zinc-900 border border-[#27272a] rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:hover:bg-indigo-600 text-sm font-medium"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
```

---

## 5. Streaming Sync Mechanics

```
┌──────────────┐         POST /api/chat/stream          ┌───────────────────┐
│              │ ─────────────────────────────────────> │                   │
│              │                                        │ 1. Save user msg  │
│              │             SSE Chunk: User Msg        │    to DB          │
│              │ < . . . . . . . . . . . . . . . . . .  │                   │
│              │                                        │ 2. Run Orchestrat.│
│   Frontend   │                                        │    Pipeline       │
│  (Chat UI)   │                                        │                   │
│              │          SSE Chunk: Status Update      │ 3. As each Agent  │
│              │ < . . . . . . . . . . . . . . . . . .  │    finishes:      │
│              │                                        │    - Write Agent  │
│              │          SSE Chunk: Researcher Msg     │      msg to DB    │
│              │ < . . . . . . . . . . . . . . . . . .  │    - Stream via   │
│              │                                        │      SSE chunk    │
│              │           SSE Chunk: Critic Msg        │                   │
│              │ < . . . . . . . . . . . . . . . . . .  │                   │
│              │                                        │                   │
└──────────────┘                                        └───────────────────┘
```

1. **User Request Submission**: The client triggers the SSE pipeline by performing a `POST` request to `/api/chat/stream` containing `{ message, branchId }`.
2. **User Message Logging**: The endpoint saves the user message into the JSON DB (`lib/db/db.ts`) with status updates immediately.
3. **Orchestrator Trigger**: The server invokes `MultiAgentOrchestrator.runParallelPipeline(...)` targeting the selected branch context.
4. **Agent-Specific Database Logging & Delivery**:
   - The multi-agent pipeline branches and performs logic asynchronously.
   - As each agent finishes, the API handler formats the resulting fact commit, creates a corresponding `Message` record (e.g. `agentType: 'researcher'`), writes it atomically to the JSON database via `addMessage()`, and pushes the formatted message object to the response SSE stream.
5. **UI Reconciliation**: The client-side stream reader processes these SSE chunks step-by-step, feeding them into local message states. By inserting both user and assistant responses directly into the database on the backend and utilizing the same schema ID contracts, the UI conversation remains synchronized on reload or route transition.
