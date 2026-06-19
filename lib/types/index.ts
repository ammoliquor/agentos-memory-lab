export interface Branch {
  id: string;             // Unique identifier (e.g. "b_123" or slug "feature-alpha")
  name: string;           // Display/human-readable name
  parentBranchId: string | null; // ID of the branch this was forked from
  forkCommitId?: string | null; // ID of the parent branch's head commit at branching time
}

export interface Commit {
  id: string;             // Unique identifier (e.g. "c_123")
  branchId: string;       // Target branch ID
  message: string;        // Commit message description
  facts: string[];        // Array of facts asserted in this commit
  parentCommit: string | null; // Parent commit ID in the DAG
  timestamp: number;      // Epoch timestamp (ms)
  retractions?: string[]; // Optional retracted/tombstoned facts
}

export interface Message {
  id: string;             // Unique message ID
  branchId: string;       // Associated branch context
  role: 'user' | 'assistant' | 'system';
  content: string;        // Text content
  agentType?: 'researcher' | 'critic' | 'builder' | null; // Agent identifier
  timestamp: number;      // Epoch timestamp (ms)
}

export interface Conflict {
  factA: string;
  factB: string;
  reason: string;
  severity: string;
}

export interface MergeProposal {
  id: string;
  sourceBranchId: string;
  targetBranchId: string;
  status: 'CONFLICT' | 'RESOLVED';
  conflicts: Conflict[]; // Details of detected conflicts
  timestamp: number;
}

export interface DatabaseSchema {
  branches: Branch[];
  commits: Commit[];
  messages: Message[];
  mergeProposals: MergeProposal[];
}
