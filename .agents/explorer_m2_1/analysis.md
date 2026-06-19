# Milestone 2: Frontend Layout & Chat UI Analysis Report

## 1. Executive Summary
This report analyzes the core requirements and proposes a clean architecture for implementing **Milestone 2: Frontend Layout & Chat UI**.
The current codebase has fully functional CLI memory operations and multi-agent backend orchestration, but does not contain any frontend pages, stylesheet files, or Tailwind CSS configurations. 

This analysis provides the complete design, layout, routing, state synchronization flow, and exact code implementations for Next.js 15, React 19, and Tailwind CSS. The design centers around a **developer-oriented dark mode workspace** featuring dynamic branch routing (`/branch/[branchId]`), automatic message history inheritance from parent branches, visual status indicators, and parallel execution indicators.

---

## 2. Current Frontend Setup Analysis
An audit of the root directory confirms the following:
* **Framework**: Next.js 15 (`package.json` targets `"next": "^15.0.0"`) and React 19 (`"react": "^19.0.0"`, `"react-dom": "^19.0.0"`).
* **Styling & Assets**: There are **no CSS config files** (`tailwind.config` or `postcss.config`) or stylesheets (e.g. `globals.css`) in the workspace. Tailwind is not in dependencies or devDependencies.
* **Component Directories**: The directories `app/` and `components/` do not exist yet.
* **Database & CLI wrapper**: A local persistence database helper exists in `lib/db/db.ts` which exposes message storage functions (`addMessage`, `getMessages`, `resetDb`), and CLI wrappers in `lib/memory/memfork.ts`.

---

## 3. Configuration Setup Proposals

### 3.1 `package.json` Updates
To support modern dark mode CSS layout, we propose adding the standard Tailwind CSS stack and class composition utilities in devDependencies/dependencies:
```json
"dependencies": {
  ...
  "clsx": "^2.1.1",
  "tailwind-merge": "^2.3.0"
},
"devDependencies": {
  ...
  "tailwindcss": "^3.4.1",
  "postcss": "^8.4.31",
  "autoprefixer": "^10.4.16"
}
```

### 3.2 `next.config.js`
Create at root to customize Next.js behavior:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
```

### 3.3 `tailwind.config.ts`
Create at root to define scanning content directories and theme values:
```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontSize: {
        '2xs': '0.65rem',
        '3xs': '0.55rem',
        '4xs': '0.45rem',
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
};
export default config;
```

### 3.4 `postcss.config.js`
Create at root to wire up Tailwind CSS:
```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### 3.5 `app/globals.css`
Create global stylesheet setting up variables and custom webkit scrollbar behaviors:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #09090b; /* bg-zinc-950 */
  --foreground: #fafafa; /* text-zinc-50 */
}

body {
  color: var(--foreground);
  background-color: var(--background);
}

/* Custom scrollbars for clean terminal styling */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #09090b;
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

## 4. App Routing & Page Architecture

### 4.1 `app/layout.tsx`
Provides the HTML baseline structure, loading global styles.
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentOS Memory Lab',
  description: 'Multi-agent developer-facing branching memory visualizer',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-full overflow-hidden text-zinc-50 antialiased selection:bg-zinc-800">
        {children}
      </body>
    </html>
  );
}
```

### 4.2 `app/page.tsx`
Handles default entry-point routing by redirecting directly to `/branch/main`.
```tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/branch/main');
}
```

### 4.3 `app/branch/[branchId]/page.tsx`
Server Component acting as the controller. Resolves the active branch details, gathers its state facts directly from CLI wrappers, queries and compiles the inherited chat messages, and loads the sidebar and chat container.
```tsx
import { getBranches, getMessages, getCommits, readDb } from '@/lib/db/db';
import { Sidebar } from '@/components/Sidebar';
import { ChatContainer } from '@/components/ChatContainer';
import { recallFacts } from '@/lib/memory/merge';
import { Message, Branch } from '@/lib/types';
import { notFound } from 'next/navigation';

// Ancestor Message Inheritance: retrieves messages on the active branch
// and traverses upwards through parents to display the full logical lineage.
async function getAncestorMessages(branchId: string): Promise<Message[]> {
  const db = await readDb();
  const messages: Message[] = [];
  let currentId: string | null = branchId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const currentIdConst = currentId;
    const branchMsgs = db.messages.filter(m => m.branchId === currentIdConst);
    messages.push(...branchMsgs);

    const branchObj = db.branches.find(b => b.id === currentIdConst || b.name === currentIdConst);
    currentId = branchObj ? branchObj.parentBranchId : null;
  }

  // Chronological sort
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

interface PageProps {
  params: Promise<{
    branchId: string;
  }>;
}

export default async function BranchPage({ params }: PageProps) {
  const resolvedParams = await params;
  const branchId = decodeURIComponent(resolvedParams.branchId);

  const branches = await getBranches();
  const activeBranch = branches.find(b => b.id === branchId || b.name === branchId);

  if (!activeBranch) {
    const mainExists = branches.some(b => b.id === 'main');
    if (branchId === 'main' && !mainExists) {
      return (
        <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
          <p>Database is empty. Please check initialization.</p>
        </div>
      );
    }
    notFound();
  }

  const db = await readDb();
  const facts = recallFacts(activeBranch.id, db);
  const messages = await getAncestorMessages(activeBranch.id);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      <Sidebar 
        branches={branches} 
        activeBranchId={activeBranch.id} 
      />
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-900/50">
        <ChatContainer 
          activeBranch={activeBranch} 
          facts={facts} 
          initialMessages={messages} 
        />
      </main>
    </div>
  );
}
```

---

## 5. Next.js Server Actions

### 5.1 `actions/chat.ts`
Enforces backend synchronization:
1. Adds user prompt record to the current branch.
2. Spawns `MultiAgentOrchestrator` to fork branches (`researcher`, `critic`, `builder`) and perform commits in parallel.
3. Formulates structured assistant messages containing facts from the CLI outputs and saves them on the current branch.
4. Triggers revalidation to refresh UI.
```typescript
'use server';

import { addMessage } from '@/lib/db/db';
import { MultiAgentOrchestrator } from '@/lib/agents/orchestrator';
import { revalidatePath } from 'next/cache';
import * as crypto from 'crypto';

export async function sendMessageAction(branchId: string, content: string) {
  if (!content || content.trim() === '') {
    throw new Error('Message content cannot be empty');
  }

  // 1. Add User Message
  await addMessage({
    id: 'm_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
    branchId,
    role: 'user',
    content: content.trim(),
    timestamp: Date.now(),
  });
  revalidatePath(`/branch/${branchId}`);

  // 2. Spawn Multi-Agent Pipeline
  const orchestrator = new MultiAgentOrchestrator();
  const timestamp = Date.now();
  const branchNames = {
    researcher: `research-${timestamp}`,
    critic: `critic-${timestamp}`,
    builder: `builder-${timestamp}`,
  };

  try {
    const results = await orchestrator.runParallelPipeline(branchId, content, branchNames);

    // 3. Add Assistant Agent Results
    await addMessage({
      id: 'm_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      branchId,
      role: 'assistant',
      agentType: 'researcher',
      content: `### Researcher Agent Completed\nForked branch: \`${branchNames.researcher}\`\n\n**Asserted Facts:**\n${results.researcher.commit.facts.map((f: string) => `- ${f}`).join('\n')}`,
      timestamp: Date.now(),
    });

    await addMessage({
      id: 'm_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      branchId,
      role: 'assistant',
      agentType: 'critic',
      content: `### Critic Agent Completed\nForked branch: \`${branchNames.critic}\`\n\n**Asserted Facts (Tradeoffs & Critique):**\n${results.critic.commit.facts.map((f: string) => `- ${f}`).join('\n')}`,
      timestamp: Date.now() + 10,
    });

    await addMessage({
      id: 'm_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      branchId,
      role: 'assistant',
      agentType: 'builder',
      content: `### Builder Agent Completed\nForked branch: \`${branchNames.builder}\`\n\n**Asserted Facts (Recommendations):**\n${results.builder.commit.facts.map((f: string) => `- ${f}`).join('\n')}`,
      timestamp: Date.now() + 20,
    });

    revalidatePath(`/branch/${branchId}`);
  } catch (error: any) {
    await addMessage({
      id: 'm_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      branchId,
      role: 'system',
      content: `Failed to execute agent pipeline: ${error.message}`,
      timestamp: Date.now(),
    });
    revalidatePath(`/branch/${branchId}`);
  }
}
```

### 5.2 `actions/branch.ts`
Forks new branches using the underlying CLI wrapper and registers the database branch structure:
```typescript
'use server';

import { branch as memforkBranch } from '@/lib/memory/memfork';
import { addBranch } from '@/lib/db/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function forkBranchAction(parentBranchId: string, newBranchName: string) {
  const trimmedName = newBranchName.trim();
  if (!trimmedName) {
    throw new Error('Branch name cannot be empty');
  }

  // 1. Run CLI command
  await memforkBranch(trimmedName, parentBranchId);

  // 2. Record to local DB
  await addBranch({
    id: trimmedName,
    name: trimmedName,
    parentBranchId: parentBranchId,
  });

  revalidatePath('/branch');
  redirect(`/branch/${trimmedName}`);
}
```

---

## 6. Interactive React Components

### 6.1 `components/Sidebar.tsx`
Handles sidebar state, filterable search of existing branches, visual highlighting of the active branch, and the creation form to fork the active branch.
```tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { GitBranch, Plus, Search, ChevronLeft, ChevronRight, HardDrive } from 'lucide-react';
import { forkBranchAction } from '@/actions/branch';
import { Branch } from '@/lib/types';

interface SidebarProps {
  branches: Branch[];
  activeBranchId: string;
}

export function Sidebar({ branches, activeBranchId }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [isForking, setIsForking] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [error, setError] = useState('');

  const filteredBranches = branches.filter(b => 
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleFork = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedName = newBranchName.trim();
    if (!trimmedName) return;

    try {
      await forkBranchAction(activeBranchId, trimmedName);
      setNewBranchName('');
      setIsForking(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create branch');
    }
  };

  if (!isOpen) {
    return (
      <div className="flex h-full w-12 flex-col items-center bg-zinc-950 py-4 border-r border-zinc-800">
        <button 
          onClick={() => setIsOpen(true)}
          className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-md transition-colors"
        >
          <ChevronRight size={18} />
        </button>
        <div className="mt-8 flex flex-col gap-4">
          {branches.map(b => (
            <Link 
              key={b.id} 
              href={`/branch/${b.id}`}
              className={`p-2 rounded-md transition-colors ${
                b.id === activeBranchId 
                  ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/30' 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={b.name}
            >
              <GitBranch size={16} />
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col bg-zinc-950 border-r border-zinc-800 text-zinc-300 transition-all duration-200">
      <div className="flex h-14 items-center justify-between px-4 border-b border-zinc-800">
        <div className="flex items-center gap-2 font-semibold text-zinc-100">
          <HardDrive className="text-emerald-500" size={18} />
          <span>Memory Lab</span>
        </div>
        <button 
          onClick={() => setIsOpen(false)}
          className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <div className="p-3">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 text-zinc-500" size={14} />
          <input 
            type="text"
            placeholder="Search branches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 text-xs rounded-md pl-8 pr-3 py-1.5 text-zinc-200 outline-none transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        <div className="flex items-center justify-between px-2 py-1 text-2xs font-semibold tracking-wider text-zinc-500 uppercase">
          <span>Branches</span>
          <span className="text-3xs bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400">
            {branches.length}
          </span>
        </div>
        
        {filteredBranches.map((b) => {
          const isActive = b.id === activeBranchId;
          const isChild = b.parentBranchId !== null;

          return (
            <Link
              key={b.id}
              href={`/branch/${b.id}`}
              className={`flex items-center justify-between px-2.5 py-2 text-xs rounded-md transition-all group ${
                isActive
                  ? 'bg-zinc-900 text-zinc-50 font-medium border border-zinc-800'
                  : 'hover:bg-zinc-900/50 hover:text-zinc-200 text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <GitBranch 
                  size={14} 
                  className={isActive ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-zinc-400'} 
                />
                <span className="truncate">
                  {isChild && <span className="text-zinc-600 mr-0.5">└─</span>}
                  {b.name}
                </span>
              </div>
              
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              )}
            </Link>
          );
        })}
      </div>

      <div className="p-3 border-t border-zinc-800 bg-zinc-900/10">
        {!isForking ? (
          <button
            onClick={() => setIsForking(true)}
            className="flex w-full items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-zinc-700 py-2 rounded-md text-xs font-medium transition-all"
          >
            <Plus size={14} />
            <span>Fork Active Branch</span>
          </button>
        ) : (
          <form onSubmit={handleFork} className="space-y-2">
            <div className="text-2xs font-semibold text-zinc-400">
              Forking from <span className="text-zinc-200">`{activeBranchId}`</span>
            </div>
            <input
              type="text"
              required
              placeholder="new-branch-name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 text-xs rounded-md px-2.5 py-1.5 text-zinc-100 outline-none transition-all"
            />
            {error && <div className="text-3xs text-red-400 font-medium">{error}</div>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsForking(false);
                  setError('');
                }}
                className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 py-1.5 rounded-md text-3xs font-medium border border-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded-md text-3xs font-medium shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-colors"
              >
                Create
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

### 6.2 `components/ChatContainer.tsx`
Handles message display, loading/submitting transitions, fact base panel layout, and optimistic rendering.
```tsx
'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { ArrowUp, Terminal, FileText, Database } from 'lucide-react';
import { sendMessageAction } from '@/actions/chat';
import { MessageItem } from './MessageItem';
import { Message, Branch } from '@/lib/types';

interface ChatContainerProps {
  activeBranch: Branch;
  facts: string[];
  initialMessages: Message[];
}

export function ChatContainer({ activeBranch, facts, initialMessages }: ChatContainerProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isPending, startTransition] = useTransition();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || isPending) return;

    setInput('');
    
    // Add optimistic user message to local state
    const tempUserMsg: Message = {
      id: 'temp_user',
      branchId: activeBranch.id,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    startTransition(async () => {
      try {
        await sendMessageAction(activeBranch.id, trimmedInput);
      } catch (err) {
        console.error('Error sending message:', err);
      }
    });
  };

  return (
    <div className="flex h-full flex-col bg-zinc-900/20 text-zinc-100">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Active Branch</span>
              {activeBranch.parentBranchId && (
                <span className="text-3xs text-zinc-600 font-mono">
                  (forked from {activeBranch.parentBranchId})
                </span>
              )}
            </div>
            <span className="text-sm font-semibold text-zinc-100 font-mono">
              {activeBranch.name}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2 text-2xs bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-md">
          <Database className="text-emerald-500" size={13} />
          <span className="text-zinc-400">Recalled Facts:</span>
          <span className="font-bold text-zinc-200">{facts.length}</span>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col justify-between overflow-y-auto px-6 py-6">
          <div className="space-y-6 max-w-3xl mx-auto w-full">
            {messages.length === 0 ? (
              <div className="flex h-96 flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
                <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-full text-zinc-400">
                  <Terminal size={32} className="text-emerald-500" />
                </div>
                <h3 className="text-sm font-medium text-zinc-200">Start the Agent Debate</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Send a prompt describing your system requirements. The Research, Critic, and Builder agents will analyze it in parallel on separate sub-branches.
                </p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <MessageItem key={msg.id === 'temp_user' ? `temp_${index}` : msg.id} message={msg} />
              ))
            )}

            {/* Pipeline progress bar / loading state */}
            {isPending && (
              <div className="space-y-4 max-w-3xl mx-auto w-full">
                <div className="flex items-start gap-4 p-4 rounded-lg bg-zinc-900/30 border border-zinc-800/50 animate-pulse">
                  <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center">
                    <Terminal size={14} className="text-emerald-500" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 bg-zinc-800 rounded" />
                    <div className="space-y-1">
                      <div className="h-2.5 w-full bg-zinc-800/60 rounded" />
                    </div>
                    <div className="mt-4 flex gap-2 text-3xs font-mono text-zinc-500">
                      <span className="bg-emerald-950/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-800/20">
                        Forking Research...
                      </span>
                      <span className="bg-amber-950/20 text-amber-400 px-2 py-0.5 rounded border border-amber-800/20">
                        Forking Critic...
                      </span>
                      <span className="bg-blue-950/20 text-blue-400 px-2 py-0.5 rounded border border-blue-800/20">
                        Forking Builder...
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Fact Side Panel */}
        <div className="w-80 border-l border-zinc-800 bg-zinc-950/30 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex items-center gap-2 bg-zinc-950/40">
            <FileText size={14} className="text-zinc-400" />
            <h2 className="text-xs font-semibold text-zinc-200">Fact Base (Current Branch)</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {facts.length === 0 ? (
              <div className="text-center py-12 text-zinc-600 text-xs">
                No facts asserted on this branch.
              </div>
            ) : (
              facts.map((fact, index) => (
                <div 
                  key={index}
                  className="p-3 text-xs bg-zinc-900 border border-zinc-800/80 rounded-md hover:border-zinc-700/60 font-mono break-words leading-relaxed text-zinc-300"
                >
                  <div className="text-3xs text-emerald-500 font-semibold mb-1 uppercase">Fact #{index + 1}</div>
                  {fact}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-950/50">
        <form onSubmit={handleSubmit} className="relative max-w-3xl mx-auto flex items-center">
          <input
            type="text"
            required
            disabled={isPending}
            placeholder="Ask the agent panel for design recommendations..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-800/50 text-sm rounded-lg px-4 py-3.5 pr-12 text-zinc-100 outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isPending || !input.trim()}
            className="absolute right-2 p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md transition-colors disabled:opacity-50"
          >
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
```

### 6.3 `components/MessageItem.tsx`
Renders message bubbles. Applies agent-specific icons, labels, and muted borders for Researcher (Green), Critic (Amber), and Builder (Blue) options.
```tsx
'use client';

import React from 'react';
import { User, ShieldAlert, Cpu, Network, CheckCircle } from 'lucide-react';
import { Message } from '@/lib/types';

interface MessageItemProps {
  message: Message;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isUser) {
    return (
      <div className="flex items-start gap-4 justify-end max-w-3xl w-full">
        <div className="flex flex-col items-end max-w-[85%]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-3xs font-semibold text-zinc-500 uppercase tracking-wider">You</span>
          </div>
          <div className="p-3.5 rounded-2xl rounded-tr-none bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 leading-relaxed shadow-sm">
            {message.content}
          </div>
        </div>
        <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-100 flex-shrink-0">
          <User size={14} />
        </div>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="flex items-start gap-4 max-w-3xl w-full">
        <div className="h-8 w-8 rounded-full bg-red-950/50 border border-red-800/30 flex items-center justify-center text-red-400 flex-shrink-0">
          <ShieldAlert size={14} />
        </div>
        <div className="flex-1 max-w-[85%] bg-red-950/20 border border-red-900/30 p-4 rounded-xl">
          <span className="text-3xs font-semibold text-red-400 uppercase tracking-wider block mb-1">System Alert</span>
          <p className="text-xs text-red-300 font-mono leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  const agentTheme = {
    researcher: {
      label: 'Researcher Agent',
      bg: 'bg-emerald-950/20 border border-emerald-900/30 text-emerald-100',
      tagColor: 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/20',
      icon: <Network size={14} className="text-emerald-400" />,
    },
    critic: {
      label: 'Critic Agent',
      bg: 'bg-amber-950/20 border border-amber-900/30 text-amber-100',
      tagColor: 'text-amber-400 bg-amber-950/40 border border-amber-800/20',
      icon: <ShieldAlert size={14} className="text-amber-400" />,
    },
    builder: {
      label: 'Builder Agent',
      bg: 'bg-blue-950/20 border border-blue-900/30 text-blue-100',
      tagColor: 'text-blue-400 bg-blue-950/40 border border-blue-800/20',
      icon: <Cpu size={14} className="text-blue-400" />,
    },
    default: {
      label: 'Assistant',
      bg: 'bg-zinc-900 border border-zinc-800 text-zinc-100',
      tagColor: 'text-zinc-400 bg-zinc-950',
      icon: <CheckCircle size={14} className="text-zinc-400" />,
    },
  };

  const theme = agentTheme[message.agentType || 'default'] || agentTheme.default;

  return (
    <div className="flex items-start gap-4 max-w-3xl w-full">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${theme.bg}`}>
        {theme.icon}
      </div>
      <div className="flex-1 max-w-[85%]">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-3xs font-semibold text-zinc-200 uppercase tracking-wider">{theme.label}</span>
          <span className={`text-4xs px-1.5 py-0.5 rounded font-mono font-medium uppercase ${theme.tagColor}`}>
            agent
          </span>
        </div>
        <div className={`p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm space-y-2 whitespace-pre-wrap ${theme.bg}`}>
          {message.content}
        </div>
      </div>
    </div>
  );
}
```

---

## 7. Verification Method
1. **Dependencies**: Verify `package.json` updates and run `npm install`.
2. **TypeScript Compilation Check**: Run `npm run verify` or type-check the compiler directly via `npx tsc --noEmit`.
3. **Mock DB Verification**: Open `tests/e2e/tier3_combined.test.js` and verify message flows write successfully using `addMessage` and `getMessages` matching structural layouts.
