# Milestone 2 Design Plan: Frontend Layout & Chat UI

This document provides a comprehensive design and implementation plan for Milestone 2 of the AgentOS Memory Lab project. It covers workspace inspection results, proposed dependency upgrades, configuration files, directory structures, and complete source code skeletons for core layout and components.

---

## 1. Workspace Configuration Inspection & Analysis

Based on the read-only exploration of the workspace root (`C:\Users\USER\antigravitycliproject\memfork`), the current configuration status and requirements are detailed below.

### 1.1 CSS / Tailwind Configuration Status
- **Current State**: 
  - There are **no CSS files or stylesheets** anywhere in the project (no `globals.css` or component stylesheets).
  - There are **no Tailwind configuration files** (`tailwind.config.ts`, `tailwind.config.js`, or `postcss.config.js`).
  - `package.json` contains dependencies for `next`, `react`, `react-dom`, `lucide-react`, and `reactflow`, but is **completely missing** core Tailwind dependencies: `tailwindcss`, `postcss`, and `autoprefixer`.
- **Required Actions**:
  1. Add Tailwind core packages and utilities to `package.json`.
  2. Create a standardized `tailwind.config.ts` configuration file.
  3. Create a `postcss.config.js` or `postcss.config.mjs` processing configuration.
  4. Establish `app/globals.css` containing the Tailwind directives and theme variables.

### 1.2 Next.js Configuration Status
- **Current State**:
  - There is **no active Next.js configuration file** (`next.config.js`, `next.config.mjs`, or `next.config.ts`) in the workspace.
  - The project relies on Next.js 15 defaults. Next.js 15 compiles TypeScript natively and supports App Router by default.
- **Required Actions**:
  1. Create a `next.config.ts` file to act as the baseline configuration for the Next.js compilation, serving as a clean placeholder for build settings, routing, or experimental switches.

---

## 2. Directory Layout & Package Upgrades

To support the React components and Tailwind configuration, the project layout will be extended. No code files will be written inside `.agents/`; they will reside in the main directories as defined by `PROJECT.md`.

### 2.1 Proposed `package.json` Additions
Add the following key devDependencies and dependencies to handle Tailwind styling, class mergers, and Server Action UI state:

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.450.0",
    "reactflow": "^11.10.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^3.4.10",
    "postcss": "^8.4.41",
    "autoprefixer": "^10.4.20"
  }
}
```

### 2.2 Configuration File Templates

#### `tailwind.config.ts`
```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
export default config
```

#### `postcss.config.js`
```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

#### `next.config.ts`
```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 15 Server Actions are active by default.
}

export default nextConfig
```

#### `app/globals.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #09090b; /* zinc-950 */
  --foreground: #fafafa; /* zinc-50 */
}

body {
  color: var(--foreground);
  background: var(--background);
}
```

#### `lib/utils.ts`
To resolve dynamic styles and custom Tailwind combinations cleanly (essential for shadcn/ui layouts):
```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## 3. Server Actions Interface Design (`actions/index.ts`)

To link the UI triggers directly with the background Memory Engine (`lib/memory/memfork.ts` and `lib/db/db.ts`), Next.js Server Actions will be declared. This separates concerns, ensuring the UI components remain Client Components that trigger database/CLI updates via typesafe Server functions.

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { getBranches, addBranch, getMessages, addMessage } from '@/lib/db/db'
import { branch as cliBranch } from '@/lib/memory/memfork'
import { MultiAgentOrchestrator } from '@/lib/agents/orchestrator'
import { Branch, Message } from '@/lib/types'

/**
 * Fetches all branches from the local database
 */
export async function fetchBranchesAction(): Promise<Branch[]> {
  return await getBranches()
}

/**
 * Creates a new branch from a specified parent context using the memfork CLI
 */
export async function forkBranchAction(name: string, fromBranchId: string): Promise<void> {
  await cliBranch(name, fromBranchId)
  revalidatePath('/')
}

/**
 * Fetches the discussion thread messages associated with a branch context
 */
export async function fetchMessagesAction(branchId: string): Promise<Message[]> {
  return await getMessages(branchId)
}

/**
 * Commits a user chat prompt, triggers the MultiAgentOrchestrator parallel pipeline,
 * and saves researcher, critic, and builder agent outcomes to the branch history database.
 */
export async function sendMessageAndTriggerOrchestratorAction(
  branchId: string,
  content: string
): Promise<void> {
  const timestamp = Date.now()

  // 1. Persist the user message to the database under the selected branch
  const userMsg: Message = {
    id: `msg_u_${timestamp}`,
    branchId,
    role: 'user',
    content,
    timestamp
  }
  await addMessage(userMsg)

  // 2. Initialize the orchestrator
  const orchestrator = new MultiAgentOrchestrator()

  // 3. Define unique tracking branches for each specialist agent
  const researchBranch = `research-${timestamp}`
  const criticBranch = `critic-${timestamp}`
  const builderBranch = `builder-${timestamp}`

  // 4. Run parallel forking and evaluation pipeline (this executes CLI commits on sub-branches)
  const pipeline = await orchestrator.runParallelPipeline(branchId, content, {
    researcher: researchBranch,
    critic: criticBranch,
    builder: builderBranch
  })

  // 5. Accumulate results and compile assistant messages
  const researcherFacts = pipeline.researcher.commit.facts.join('\n')
  const criticFacts = pipeline.critic.commit.facts.join('\n')
  const builderFacts = pipeline.builder.commit.facts.join('\n')

  const agentMessages: Message[] = [
    {
      id: `msg_r_${timestamp}`,
      branchId,
      role: 'assistant',
      agentType: 'researcher',
      content: researcherFacts || 'No research facts compiled.',
      timestamp: timestamp + 10
    },
    {
      id: `msg_c_${timestamp}`,
      branchId,
      role: 'assistant',
      agentType: 'critic',
      content: criticFacts || 'No criticisms/tradeoffs compiled.',
      timestamp: timestamp + 20
    },
    {
      id: `msg_b_${timestamp}`,
      branchId,
      role: 'assistant',
      agentType: 'builder',
      content: builderFacts || 'No build recommendation compiled.',
      timestamp: timestamp + 30
    }
  ]

  // 6. Write agent responses to the DB under the parent branch so they render in its thread
  for (const msg of agentMessages) {
    await addMessage(msg)
  }

  revalidatePath('/')
}
```

---

## 4. UI Shell, Layout & Page Architecture

The layout implements a 2-column sidebar design. The client-side page manages active branch state, handles background loading transitions, and propagates changes from the `Sidebar` to the `ChatPanel`.

### 4.1 Root Layout Component (`app/layout.tsx`)
```tsx
import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'AgentOS Memory Lab',
  description: 'Interact with branching agent memory pipelines',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full dark">
      <body className={`${inter.className} h-full bg-zinc-950 text-zinc-50 overflow-hidden antialiased`}>
        <div className="flex h-full w-full overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}
```

### 4.2 Main Entry Page (`app/page.tsx`)
```tsx
'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatPanel from '@/components/ChatPanel'
import { Branch, Message } from '@/lib/types'
import {
  fetchBranchesAction,
  forkBranchAction,
  fetchMessagesAction,
  sendMessageAndTriggerOrchestratorAction
} from '@/actions'

export default function Home() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [activeBranchId, setActiveBranchId] = useState<string>('main')
  const [messages, setMessages] = useState<Message[]>([])

  // 1. Initial hydration: load available branches
  useEffect(() => {
    async function loadInitialData() {
      try {
        const brs = await fetchBranchesAction()
        setBranches(brs)
        
        if (brs.length > 0) {
          const mainExists = brs.some(b => b.id === 'main')
          setActiveBranchId(mainExists ? 'main' : brs[0].id)
        }
      } catch (err) {
        console.error('Failed to load branches:', err)
      }
    }
    loadInitialData()
  }, [])

  // 2. Thread sync: load messages whenever the selected branch context changes
  useEffect(() => {
    async function loadMessages() {
      try {
        const msgs = await fetchMessagesAction(activeBranchId)
        setMessages(msgs)
      } catch (err) {
        console.error('Failed to load messages for branch:', activeBranchId, err)
      }
    }
    loadMessages()
  }, [activeBranchId])

  // 3. Trigger fork branch event
  const handleForkBranch = async (name: string, fromBranchId: string) => {
    await forkBranchAction(name, fromBranchId)
    // Synchronize Sidebar branch list from database
    const updatedBranches = await fetchBranchesAction()
    setBranches(updatedBranches)
  }

  // 4. Trigger chat submission and pipeline orchestration
  const handleSendMessage = async (content: string) => {
    // Optimistic UI update: display user input instantly in chat thread
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      branchId: activeBranchId,
      role: 'user',
      content,
      timestamp: Date.now()
    }
    setMessages(prev => [...prev, tempUserMsg])

    // Await server-side execution of research -> critic -> builder parallel pipeline
    await sendMessageAndTriggerOrchestratorAction(activeBranchId, content)

    // Re-fetch all messages from DB to display the formatted outcomes from the 3 agents
    const updatedMessages = await fetchMessagesAction(activeBranchId)
    setMessages(updatedMessages)
  }

  return (
    <main className="flex h-full w-full overflow-hidden bg-zinc-950">
      {/* Sidebar component handling branch context and creation */}
      <Sidebar
        branches={branches}
        activeBranchId={activeBranchId}
        onSelectBranch={setActiveBranchId}
        onForkBranch={handleForkBranch}
      />

      {/* Chat panel rendering messages and pipeline status */}
      <ChatPanel
        branchId={activeBranchId}
        messages={messages}
        onSendMessage={handleSendMessage}
      />
    </main>
  )
}
```

---

## 5. Sidebar Component Design (`components/Sidebar.tsx`)

The sidebar component provides structural search and navigation over local memfork branches. It includes:
- An input search bar to filter branches.
- Active context indicators (clearly showing parentage dependencies).
- Form validation to prevent incorrect characters, empty states, or duplicate branch names before invoking CLI actions.

```tsx
'use client'

import { useState } from 'react'
import { Branch } from '@/lib/types'
import { GitFork, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarProps {
  branches: Branch[]
  activeBranchId: string
  onSelectBranch: (branchId: string) => void
  onForkBranch: (name: string, fromBranchId: string) => Promise<void>
}

export default function Sidebar({
  branches,
  activeBranchId,
  onSelectBranch,
  onForkBranch
}: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [isForking, setIsForking] = useState(false)
  const [error, setError] = useState('')

  // Filter list dynamically based on search
  const filteredBranches = branches.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const activeBranch = branches.find(b => b.id === activeBranchId)

  // Validate form submission locally to maintain robust user feedback
  const handleForkSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    const trimmed = newBranchName.trim()
    if (!trimmed) {
      setError('Branch name cannot be empty')
      return
    }
    // Adheres to validation rules in lib/memory/memfork.ts
    if (!/^[a-zA-Z0-9-_/]+$/.test(trimmed)) {
      setError('Alphanumeric and - _ / only')
      return
    }
    if (branches.some(b => b.name.toLowerCase() === trimmed.toLowerCase() || b.id.toLowerCase() === trimmed.toLowerCase())) {
      setError('Branch name already exists')
      return
    }

    try {
      setIsForking(true)
      await onForkBranch(trimmed, activeBranchId)
      setNewBranchName('')
      onSelectBranch(trimmed) // Automatically traverse into new context
    } catch (err: any) {
      setError(err.message || 'Failed to fork branch')
    } finally {
      setIsForking(false)
    }
  }

  return (
    <aside className="w-80 flex-shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col h-full text-zinc-300">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        <GitFork className="h-5 w-5 text-indigo-400" />
        <span className="font-semibold text-lg text-zinc-100">Memory Lab Branches</span>
      </div>

      {/* Active branch display with lineage parent metadata */}
      <div className="p-4 bg-zinc-950/40 border-b border-zinc-800/60">
        <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Active Context</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-indigo-400 text-sm font-bold truncate">
            {activeBranch?.name || activeBranchId}
          </span>
          {activeBranch?.parentBranchId && (
            <span className="text-xs text-zinc-500 truncate max-w-[120px]" title={`Parent: ${activeBranch.parentBranchId}`}>
              parent: {activeBranch.parentBranchId}
            </span>
          )}
        </div>
      </div>

      {/* Action panel: Create (fork) a new branch */}
      <form onSubmit={handleForkSubmit} className="p-4 border-b border-zinc-800 flex flex-col gap-2">
        <label className="text-xs text-zinc-400 font-medium">Fork from: {activeBranch?.name || activeBranchId}</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="new-branch-name"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            disabled={isForking}
            className="flex-grow bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isForking}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded p-2 flex items-center justify-center disabled:opacity-50 transition-colors"
            title="Fork active branch"
          >
            {isForking ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </form>

      {/* Filter branches */}
      <div className="p-4 border-b border-zinc-800/40">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-600" />
          <input
            type="text"
            placeholder="Search branches..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800/80 rounded pl-9 pr-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
          />
        </div>
      </div>

      {/* Scrollable branch selector list */}
      <div className="flex-grow overflow-y-auto p-2 space-y-1">
        {filteredBranches.length === 0 ? (
          <p className="text-center text-xs text-zinc-600 py-8">No branches found</p>
        ) : (
          filteredBranches.map((br) => (
            <button
              key={br.id}
              onClick={() => onSelectBranch(br.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded flex items-center justify-between text-sm transition-colors group",
                br.id === activeBranchId
                  ? "bg-indigo-950/40 text-indigo-300 border border-indigo-900/60"
                  : "hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 border border-transparent"
              )}
            >
              <span className="font-mono truncate">{br.name}</span>
              <span className="text-[10px] text-zinc-600 group-hover:text-zinc-500 font-mono">
                {br.id}
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
```

---

## 6. Chat Panel Component Design (`components/ChatPanel.tsx`)

The chat panel is the orchestrator visualizer. When user prompts are submitted:
1. It displays an immediate optimistic user bubble.
2. It toggles a mock-streaming pipeline state, illustrating the stages of parallel agent execution:
   - **Researcher**: Forking research branch, compiling facts.
   - **Critic**: Forking critic branch, evaluating weaknesses/tradeoffs.
   - **Builder**: Forking builder branch, drafting architect recommendations.
3. Once the server finishes, it hides the visualizer and loads the formatted bubbles for each Specialist Agent, each highlighted with specific icons, badges, borders, and color schemes.

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { Message } from '@/lib/types'
import { Search, ShieldAlert, Cpu, Send, User, GitFork } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatPanelProps {
  branchId: string
  messages: Message[]
  onSendMessage: (content: string) => Promise<void>
}

type AgentType = 'researcher' | 'critic' | 'builder'

export default function ChatPanel({
  branchId,
  messages,
  onSendMessage
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [pipelineStep, setPipelineStep] = useState<number>(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll viewport down upon new chat activity
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isPending, pipelineStep])

  // Simulates progress steps of parallel orchestrator pipelines for refined UX
  useEffect(() => {
    if (!isPending) {
      setPipelineStep(0)
      return
    }

    const timer1 = setTimeout(() => setPipelineStep(1), 800)   // Researcher executes
    const timer2 = setTimeout(() => setPipelineStep(2), 2000)  // Critic executes
    const timer3 = setTimeout(() => setPipelineStep(3), 3200)  // Builder executes

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [isPending])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = inputValue.trim()
    if (!content || isPending) return

    setInputValue('')
    setIsPending(true)
    try {
      await onSendMessage(content)
    } catch (err) {
      console.error('Chat submission failed:', err)
    } finally {
      setIsPending(false)
    }
  }

  // Visual treatments & badges for Specialist Agents
  const agentConfigs: Record<AgentType, {
    label: string
    badgeColor: string
    borderColor: string
    textColor: string
    bgColor: string
    icon: React.ReactNode
    description: string
  }> = {
    researcher: {
      label: 'Research Agent',
      badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      borderColor: 'border-blue-500/30',
      textColor: 'text-blue-200',
      bgColor: 'bg-blue-950/10',
      icon: <Search className="h-4 w-4 text-blue-400" />,
      description: 'Fact-gathering, alternatives, tradeoffs'
    },
    critic: {
      label: 'Critic Agent',
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      borderColor: 'border-amber-500/30',
      textColor: 'text-amber-200',
      bgColor: 'bg-amber-950/10',
      icon: <ShieldAlert className="h-4 w-4 text-amber-400" />,
      description: 'Weaknesses, counter-arguments, system constraints'
    },
    builder: {
      label: 'Builder Agent',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      borderColor: 'border-emerald-500/30',
      textColor: 'text-emerald-200',
      bgColor: 'bg-emerald-950/10',
      icon: <Cpu className="h-4 w-4 text-emerald-400" />,
      description: 'Architecture, specifications, recommendations'
    }
  }

  return (
    <div className="flex-grow flex flex-col h-full bg-zinc-950">
      {/* Header bar */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
        <div>
          <h2 className="text-zinc-200 font-medium text-sm">Agent Discussion Thread</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Active context branch: <span className="font-mono text-zinc-400">{branchId}</span>
          </p>
        </div>
      </div>

      {/* Message history */}
      <div className="flex-grow overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isPending && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
            <GitFork className="h-10 w-10 text-zinc-700 animate-pulse mb-3" />
            <h3 className="text-zinc-400 font-semibold text-sm">No messages in branch</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Ask a system design or architecture question. The multi-agent coordinator will branch and consult the Researcher, Critic, and Builder agents in parallel.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user'
          const agent = msg.agentType ? agentConfigs[msg.agentType as AgentType] : null

          return (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 max-w-3xl rounded-lg p-4 border transition-all duration-200",
                isUser
                  ? "bg-zinc-900 border-zinc-800 ml-auto flex-row-reverse"
                  : agent
                    ? cn(agent.bgColor, agent.borderColor)
                    : "bg-zinc-900/40 border-zinc-800 mr-auto"
              )}
            >
              {/* Profile Avatar */}
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 border",
                isUser
                  ? "bg-indigo-900/30 border-indigo-700 text-indigo-400"
                  : agent
                    ? "bg-zinc-900 border-zinc-700"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400"
              )}>
                {isUser ? <User className="h-4 w-4" /> : agent ? agent.icon : <Cpu className="h-4 w-4" />}
              </div>

              {/* Message Details */}
              <div className="flex-grow space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-zinc-300">
                    {isUser ? 'You (User)' : agent ? agent.label : 'System Coordinator'}
                  </span>
                  {agent && (
                    <span className={cn("text-[10px] px-2 py-0.5 rounded border font-medium", agent.badgeColor)}>
                      {agent.description}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-600 font-mono ml-auto">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                <div className={cn(
                  "text-sm leading-relaxed whitespace-pre-wrap",
                  isUser ? "text-zinc-200" : agent ? agent.textColor : "text-zinc-400"
                )}>
                  {msg.content}
                </div>
              </div>
            </div>
          )
        })}

        {/* Parallel Agent Pipeline Execution Visualizer */}
        {isPending && (
          <div className="space-y-4 pt-2">
            {/* Server action pending status indicator */}
            <div className="text-zinc-400 text-xs italic flex items-center gap-1.5 px-4 py-1.5 bg-zinc-900/20 border border-zinc-800/40 rounded-md w-max animate-pulse">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              Processing architectural request and invoking Multi-Agent Pipeline...
            </div>

            {/* Stepper Pipeline visual display */}
            <div className="border border-zinc-800 rounded-lg bg-zinc-900/60 p-5 space-y-4 max-w-3xl">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <GitFork className="h-4 w-4 text-zinc-500 animate-spin" />
                Executing Pipeline on Parent Branch Context: {branchId}
              </h4>

              <div className="space-y-3">
                {/* Researcher workflow step */}
                <div className={cn(
                  "flex items-start gap-3 p-3 rounded border text-sm transition-all duration-300",
                  pipelineStep >= 1 ? "bg-blue-950/10 border-blue-500/20 text-blue-200" : "opacity-40 border-zinc-800"
                )}>
                  <div className={cn("p-1.5 rounded-full border bg-zinc-950 text-blue-400", pipelineStep === 1 && "animate-pulse border-blue-500")}>
                    <Search className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-xs text-zinc-300 flex items-center gap-2">
                      Research Agent
                      {pipelineStep === 1 && <span className="text-[10px] text-blue-400 animate-pulse animate-duration-1000">running...</span>}
                      {pipelineStep > 1 && <span className="text-[10px] text-zinc-500 font-medium">completed</span>}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {pipelineStep === 0 && "Waiting to fork branch..."}
                      {pipelineStep === 1 && "Forked 'research-xxxx' branch. Querying knowledge base and formulating technical alternatives..."}
                      {pipelineStep > 1 && "Success. Extracted facts relating to transactional processing and analytics trade-offs."}
                    </p>
                  </div>
                </div>

                {/* Critic workflow step */}
                <div className={cn(
                  "flex items-start gap-3 p-3 rounded border text-sm transition-all duration-300",
                  pipelineStep >= 2 ? "bg-amber-950/10 border-amber-500/20 text-amber-200" : "opacity-40 border-zinc-800"
                )}>
                  <div className={cn("p-1.5 rounded-full border bg-zinc-950 text-amber-400", pipelineStep === 2 && "animate-pulse border-amber-500")}>
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-xs text-zinc-300 flex items-center gap-2">
                      Critic Agent
                      {pipelineStep === 2 && <span className="text-[10px] text-amber-400 animate-pulse">running...</span>}
                      {pipelineStep > 2 && <span className="text-[10px] text-zinc-500 font-medium">completed</span>}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {pipelineStep < 2 && "Awaiting Research findings..."}
                      {pipelineStep === 2 && "Forked 'critic-xxxx' branch. Evaluating research alternatives for performance limits, resource limits, and scale-out issues..."}
                      {pipelineStep > 2 && "Success. Identified concurrency bottlenecks, data leakage risks, and air-gapped constraints."}
                    </p>
                  </div>
                </div>

                {/* Builder workflow step */}
                <div className={cn(
                  "flex items-start gap-3 p-3 rounded border text-sm transition-all duration-300",
                  pipelineStep >= 3 ? "bg-emerald-950/10 border-emerald-500/20 text-emerald-200" : "opacity-40 border-zinc-800"
                )}>
                  <div className={cn("p-1.5 rounded-full border bg-zinc-950 text-emerald-400", pipelineStep === 3 && "animate-pulse border-emerald-500")}>
                    <Cpu className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-xs text-zinc-300 flex items-center gap-2">
                      Builder Agent
                      {pipelineStep === 3 && <span className="text-[10px] text-emerald-400 animate-pulse font-medium">running...</span>}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {pipelineStep < 3 && "Awaiting Critic validation..."}
                      {pipelineStep === 3 && "Forked 'builder-xxxx' branch. Compiling research tradeoffs and constraints into structured architectural guidelines..."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Footer */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Type your design prompt (e.g. 'Build database cluster for SaaS banking')..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isPending}
            className="flex-grow bg-zinc-950 border border-zinc-800 rounded px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isPending || !inputValue.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-md px-4 py-2.5 flex items-center gap-2 text-sm font-semibold disabled:opacity-40 disabled:hover:bg-indigo-600 transition-colors"
          >
            <Send className="h-4 w-4" />
            <span>Ask Agents</span>
          </button>
        </form>
        <p className="text-[10px] text-zinc-600 mt-2 text-center">
          Powered by AgentOS Parallel Memory Engine. All operations run transactionally under file locks.
        </p>
      </div>
    </div>
  )
}
```

---

## 7. Integration & Execution Verification Plan

To verify that Milestone 2 is correctly integrated and ready, developers should follow these testing procedures:

1. **Static Analysis & Type Checks**:
   Validate code correctness and compilation under Next.js 15:
   ```powershell
   npm run verify
   ```
2. **Interactive Manual Test Pass**:
   - Spin up the local development server: `npm run dev`
   - Navigate to `http://localhost:3000`.
   - Create/fork a new branch `dev-scenario` from the `Sidebar`. Ensure validation stops duplicate/invalid characters.
   - Enter a chat prompt (e.g. `Use cache database`).
   - Check that the optimistic User message appears.
   - Verify the multi-agent orchestration progress stepper renders and sequences correctly in `ChatPanel`.
   - Verify the database file at `.memfork/db.json` has added three new assistant messages with researcher, critic, and builder attributes linked to the parent branch.
   - Check that the three agent response bubbles render in the chat history, with color codings matches (Blue, Amber, Green).
