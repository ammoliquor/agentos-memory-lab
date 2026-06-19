import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseSchema, Branch, Commit, Message } from '../types';

export function getDbPath(): string {
  if (process.env.MEMFORK_DB_PATH) {
    return path.resolve(process.env.MEMFORK_DB_PATH);
  }
  return path.resolve('.memfork/db.json');
}

let queue = Promise.resolve();

async function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const nextPromise = new Promise<T>((resolve, reject) => {
    queue.then(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      reject(err);
    });
  });
  queue = nextPromise.then(() => {}, () => {});
  return nextPromise;
}

export function validateSchema(db: any): db is DatabaseSchema {
  if (!db || typeof db !== 'object') return false;
  if (!Array.isArray(db.branches)) return false;
  if (!Array.isArray(db.commits)) return false;
  if (!Array.isArray(db.messages)) return false;
  if (!Array.isArray(db.mergeProposals)) return false;
  
  // Validate branches
  for (const b of db.branches) {
    if (typeof b.id !== 'string' || typeof b.name !== 'string') return false;
    if (b.parentBranchId !== null && typeof b.parentBranchId !== 'string') return false;
    if (b.forkCommitId !== undefined && b.forkCommitId !== null && typeof b.forkCommitId !== 'string') return false;
  }
  
  // Validate commits
  for (const c of db.commits) {
    if (typeof c.id !== 'string' || typeof c.branchId !== 'string' || typeof c.message !== 'string') return false;
    if (!Array.isArray(c.facts) || c.facts.some((f: unknown) => typeof f !== 'string')) return false;
    if (c.parentCommit !== null && typeof c.parentCommit !== 'string') return false;
    if (typeof c.timestamp !== 'number') return false;
    if (c.retractions !== undefined && (!Array.isArray(c.retractions) || c.retractions.some((f: unknown) => typeof f !== 'string'))) return false;
  }

  // Validate messages
  for (const m of db.messages) {
    if (typeof m.id !== 'string' || typeof m.branchId !== 'string' || typeof m.content !== 'string') return false;
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return false;
    if (m.agentType !== undefined && m.agentType !== null && typeof m.agentType !== 'string') return false;
    if (typeof m.timestamp !== 'number') return false;
  }

  // Validate mergeProposals
  for (const mp of db.mergeProposals) {
    if (typeof mp.id !== 'string' || typeof mp.sourceBranchId !== 'string' || typeof mp.targetBranchId !== 'string') return false;
    if (mp.status !== 'CONFLICT' && mp.status !== 'RESOLVED') return false;
    if (typeof mp.timestamp !== 'number') return false;
    if (!Array.isArray(mp.conflicts)) return false;
    for (const c of mp.conflicts) {
      if (typeof c.factA !== 'string' || typeof c.factB !== 'string' || typeof c.reason !== 'string' || typeof c.severity !== 'string') return false;
    }
  }

  return true;
}

async function acquireLockAsync(dbPath: string, ownerToken: string, timeoutMs = 10000): Promise<void> {
  const lockPath = `${dbPath}.lock`;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(path.join(lockPath, 'owner'), ownerToken, 'utf8');
      return; // Lock acquired
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          const stats = await fs.stat(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            const staleLockPath = dbPath + '.lock.stale.' + crypto.randomUUID();
            try {
              await fs.rename(lockPath, staleLockPath);
              if (fs.rm) {
                await fs.rm(staleLockPath, { recursive: true, force: true });
              } else {
                await fs.rmdir(staleLockPath);
              }
            } catch (_) {
              // rename failed, another process won the race; do nothing
            }
          }
        } catch (_) {}
        if (Date.now() - start > timeoutMs) {
          throw new Error('Lock acquisition timeout');
        }
        const backoff = 20 + Math.floor(Math.random() * 31); // 20-50ms backoff
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        throw err;
      }
    }
  }
}

async function releaseLockAsync(dbPath: string, ownerToken: string): Promise<void> {
  const lockPath = `${dbPath}.lock`;
  try {
    const ownerFile = path.join(lockPath, 'owner');
    const token = await fs.readFile(ownerFile, 'utf8');
    if (token === ownerToken) {
      try {
        await fs.unlink(ownerFile);
      } catch (_) {}
      await fs.rmdir(lockPath);
    }
  } catch (_) {}
}

async function readDbInternal(): Promise<DatabaseSchema> {
  const dbPath = getDbPath();
  try {
    const content = await fs.readFile(dbPath, 'utf8');
    try {
      const parsed = JSON.parse(content) as DatabaseSchema;
      if (!parsed.mergeProposals) {
        parsed.mergeProposals = [];
      }
      if (!validateSchema(parsed)) {
        throw new Error('Invalid schema in readDb');
      }
      return parsed;
    } catch (jsonErr) {
      // Backup corrupt file and re-initialize
      const corruptedPath = dbPath.endsWith('.json')
        ? dbPath.slice(0, -5) + '.corrupted.json'
        : dbPath + '.corrupted';
      try {
        await fs.rename(dbPath, corruptedPath);
      } catch (renameErr) {
        // Ignore rename failure
      }
      const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      await fs.rename(tempPath, dbPath);
      return defaultDb;
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const defaultDb: DatabaseSchema = { branches: [], commits: [], messages: [], mergeProposals: [] };
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      await fs.rename(tempPath, dbPath);
      return defaultDb;
    }
    throw error;
  }
}

async function writeDbInternal(db: DatabaseSchema): Promise<void> {
  if (!validateSchema(db)) {
    throw new Error('Invalid database schema');
  }
  const dbPath = getDbPath();
  const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tempPath, dbPath);
}

function mergeRecordsById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of base) {
    map.set(item.id, item);
  }
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function mergeDbSchemas(base: DatabaseSchema, incoming: DatabaseSchema): DatabaseSchema {
  return {
    branches: mergeRecordsById(base.branches, incoming.branches),
    commits: mergeRecordsById(base.commits, incoming.commits),
    messages: mergeRecordsById(base.messages, incoming.messages),
    mergeProposals: mergeRecordsById(base.mergeProposals, incoming.mergeProposals),
  };
}

/** Persist DB state while already inside an updateDb lock (e.g. before throwing). */
export async function writeDbSnapshot(db: DatabaseSchema): Promise<void> {
  await writeDbInternal(db);
}

export async function readDb(): Promise<DatabaseSchema> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    const ownerToken = crypto.randomUUID();
    await acquireLockAsync(dbPath, ownerToken);
    try {
      return await readDbInternal();
    } finally {
      await releaseLockAsync(dbPath, ownerToken);
    }
  });
}

export async function writeDb(db: DatabaseSchema): Promise<void> {
  if (!validateSchema(db)) {
    throw new Error('Invalid database schema');
  }
  return enqueue(async () => {
    const dbPath = getDbPath();
    const ownerToken = crypto.randomUUID();
    await acquireLockAsync(dbPath, ownerToken);
    try {
      const current = await readDbInternal();
      const merged = mergeDbSchemas(current, db);
      await writeDbInternal(merged);
    } finally {
      await releaseLockAsync(dbPath, ownerToken);
    }
  });
}

export async function updateDb(updater: (db: DatabaseSchema) => void | Promise<void>): Promise<void> {
  return enqueue(async () => {
    const dbPath = getDbPath();
    const ownerToken = crypto.randomUUID();
    await acquireLockAsync(dbPath, ownerToken);
    try {
      const db = await readDbInternal();
      await updater(db);
      await writeDbInternal(db);
    } finally {
      await releaseLockAsync(dbPath, ownerToken);
    }
  });
}

export async function getBranches(): Promise<Branch[]> {
  const db = await readDb();
  return db.branches;
}

export async function addBranch(branch: Branch): Promise<void> {
  await updateDb((db) => {
    if (db.branches.some(b => b.name === branch.name || b.id === branch.id)) {
      throw new Error(`Branch with name "${branch.name}" or ID "${branch.id}" already exists`);
    }
    db.branches.push(branch);
  });
}

export async function getCommits(branchId?: string): Promise<Commit[]> {
  const db = await readDb();
  if (branchId) {
    return db.commits.filter(c => c.branchId === branchId);
  }
  return db.commits;
}

export async function addCommit(commit: Commit): Promise<void> {
  await updateDb((db) => {
    db.commits.push(commit);
  });
}

export async function getMessages(branchId?: string): Promise<Message[]> {
  const db = await readDb();
  if (branchId) {
    return db.messages.filter(m => m.branchId === branchId);
  }
  return db.messages;
}

export async function addMessage(message: Message): Promise<void> {
  await updateDb((db) => {
    db.messages.push(message);
  });
}

export async function resetDb(seedBranches: Branch[] = []): Promise<void> {
  await updateDb((db) => {
    db.branches = seedBranches;
    db.commits = [];
    db.messages = [];
    db.mergeProposals = [];
  });
}
