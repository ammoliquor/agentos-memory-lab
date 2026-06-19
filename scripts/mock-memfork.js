const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function maybeSleepForTimeoutTest() {
  if (process.env.MOCK_MEMFORK_SLEEP === 'true' || process.argv.includes('--sleep')) {
    // Block until parent process kills this CLI (timeout test)
    while (true) {}
  }
}

maybeSleepForTimeoutTest();

function getDbPath() {
  if (process.env.MEMFORK_DB_PATH) {
    return path.resolve(process.env.MEMFORK_DB_PATH);
  }
  return path.resolve('.memfork/db.json');
}

function validateSchema(db) {
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
    if (!Array.isArray(c.facts) || c.facts.some(f => typeof f !== 'string')) return false;
    if (c.parentCommit !== null && typeof c.parentCommit !== 'string') return false;
    if (typeof c.timestamp !== 'number') return false;
    if (c.retractions !== undefined && (!Array.isArray(c.retractions) || c.retractions.some(f => typeof f !== 'string'))) return false;
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

function acquireLockSync(dbPath, ownerToken, timeoutMs = 10000) {
  const lockPath = dbPath + '.lock';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'owner'), ownerToken, 'utf8');
      return;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stats = fs.statSync(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            const staleLockPath = dbPath + '.lock.stale.' + crypto.randomUUID();
            try {
              fs.renameSync(lockPath, staleLockPath);
              if (fs.rmSync) {
                fs.rmSync(staleLockPath, { recursive: true, force: true });
              } else {
                fs.rmdirSync(staleLockPath);
              }
            } catch (_) {
              // rename failed, another process won the race; do nothing
            }
          }
        } catch (_) {}
        if (Date.now() - start > timeoutMs) {
          throw new Error('Lock acquisition timeout');
        }
        const backoff = 20 + Math.floor(Math.random() * 31);
        const sleepUntil = Date.now() + backoff;
        while (Date.now() < sleepUntil) {}
      } else {
        throw err;
      }
    }
  }
}

function releaseLockSync(dbPath, ownerToken) {
  const lockPath = dbPath + '.lock';
  try {
    const ownerFile = path.join(lockPath, 'owner');
    const token = fs.readFileSync(ownerFile, 'utf8');
    if (token === ownerToken) {
      try {
        fs.unlinkSync(ownerFile);
      } catch (_) {}
      fs.rmdirSync(lockPath);
    }
  } catch (_) {}
}

function runTransactional(fn) {
  const dbPath = getDbPath();
  const ownerToken = crypto.randomUUID();
  acquireLockSync(dbPath, ownerToken);
  try {
    fn();
  } catch (err) {
    releaseLockSync(dbPath, ownerToken);
    console.error(err.message);
    process.exit(1);
  }
  releaseLockSync(dbPath, ownerToken);
}

function readDb() {
  const dbPath = getDbPath();
  try {
    if (!fs.existsSync(dbPath)) {
      const defaultDb = { branches: [], commits: [], messages: [], mergeProposals: [] };
      writeDb(defaultDb);
      return defaultDb;
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed.mergeProposals) {
      parsed.mergeProposals = [];
    }
    if (!validateSchema(parsed)) {
      throw new Error('Invalid schema');
    }
    return parsed;
  } catch (err) {
    const corruptedPath = dbPath.endsWith('.json')
      ? dbPath.slice(0, -5) + '.corrupted.json'
      : dbPath + '.corrupted';
    try {
      fs.renameSync(dbPath, corruptedPath);
    } catch (_) {}
    const defaultDb = { branches: [], commits: [], messages: [], mergeProposals: [] };
    writeDb(defaultDb);
    return defaultDb;
  }
}

function mergeRecordsById(base, incoming) {
  const map = new Map();
  for (const item of base) {
    map.set(item.id, item);
  }
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function mergeDbSchemas(base, incoming) {
  return {
    branches: mergeRecordsById(base.branches || [], incoming.branches || []),
    commits: mergeRecordsById(base.commits || [], incoming.commits || []),
    messages: mergeRecordsById(base.messages || [], incoming.messages || []),
    mergeProposals: mergeRecordsById(base.mergeProposals || [], incoming.mergeProposals || []),
  };
}

function readDbFromFileRaw() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    return { branches: [], commits: [], messages: [], mergeProposals: [] };
  }
  const data = fs.readFileSync(dbPath, 'utf8');
  const parsed = JSON.parse(data);
  if (!parsed.mergeProposals) {
    parsed.mergeProposals = [];
  }
  return parsed;
}

function writeDb(db) {
  if (!validateSchema(db)) {
    throw new Error('Invalid database schema');
  }
  const dbPath = getDbPath();
  let base = { branches: [], commits: [], messages: [], mergeProposals: [] };
  if (fs.existsSync(dbPath)) {
    try {
      const parsed = readDbFromFileRaw();
      if (validateSchema(parsed)) {
        base = parsed;
      }
    } catch (_) {}
  }
  const merged = mergeDbSchemas(base, db);
  if (!validateSchema(merged)) {
    throw new Error('Invalid database schema');
  }
  const tempPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tempPath, dbPath);
}

function getBranchHeadCommitId(db, branchId) {
  const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
  if (!branchObj) return null;

  const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
  if (branchCommits.length > 0) {
    branchCommits.sort((a, b) => b.timestamp - a.timestamp);
    return branchCommits[0].id;
  }
  if (branchObj.forkCommitId) {
    return branchObj.forkCommitId;
  }

  let parentId = branchObj.parentBranchId;
  const visitedBranches = new Set([branchObj.id]);
  while (parentId) {
    if (visitedBranches.has(parentId)) break;
    visitedBranches.add(parentId);
    
    const parentObj = db.branches.find(b => b.id === parentId || b.name === parentId);
    if (!parentObj) break;
    const parentCommits = db.commits.filter(c => c.branchId === parentObj.id);
    if (parentCommits.length > 0) {
      parentCommits.sort((a, b) => b.timestamp - a.timestamp);
      return parentCommits[0].id;
    }
    parentId = parentObj.parentBranchId;
  }
  return null;
}

function getAncestorCommits(db, startCommitId) {
  if (!startCommitId) return [];
  const commitMap = new Map();
  for (const c of db.commits) {
    commitMap.set(c.id, c);
  }

  const visited = new Set();
  const list = [];
  const queue = [startCommitId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const commit = commitMap.get(currentId);
    if (commit) {
      list.push(commit);
      if (commit.parentCommit) {
        const parents = commit.parentCommit.split(',');
        for (const p of parents) {
          const trimmed = p.trim();
          if (trimmed && !visited.has(trimmed)) {
            queue.push(trimmed);
          }
        }
      } else {
        const branchObj = db.branches.find(b => b.id === commit.branchId);
        if (branchObj && branchObj.parentBranchId) {
          const parentStartId = branchObj.forkCommitId || getBranchHeadCommitId(db, branchObj.parentBranchId);
          if (parentStartId && !visited.has(parentStartId)) {
            queue.push(parentStartId);
          }
        }
      }
    }
  }
  return list.sort((a, b) => a.timestamp - b.timestamp);
}

function normalizeFact(fact) {
  return fact.toLowerCase().trim().replace(/\.+$/, '');
}

function recallFacts(db, branchId) {
  const headCommitId = getBranchHeadCommitId(db, branchId);
  if (!headCommitId) return [];

  const activeNormalized = new Set();
  const originalCaseMap = new Map();

  const ancestors = getAncestorCommits(db, headCommitId).sort((a, b) => a.timestamp - b.timestamp);

  for (const commit of ancestors) {
    if (commit.retractions) {
      for (const r of commit.retractions) {
        activeNormalized.delete(normalizeFact(r));
      }
    }
    for (const fact of commit.facts) {
      const normFact = normalizeFact(fact);
      activeNormalized.add(normFact);
      originalCaseMap.set(normFact, fact);
    }
  }

  return Array.from(activeNormalized).map(norm => originalCaseMap.get(norm));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: mock-memfork <command> [args]");
    process.exit(1);
  }

  const command = args[0];
  if (command.startsWith('-')) {
    console.error(`Unsupported flag or command: ${command}`);
    process.exit(1);
  }

  if (command === 'branch') {
    // Validate invalid flags first
    const allowedFlags = ['--from', '--sleep'];
    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith('-')) {
        if (!allowedFlags.includes(args[i])) {
          console.error(`Unsupported flag: ${args[i]}`);
          process.exit(1);
        }
        if (args[i] === '--from') {
          i++;
        }
      }
    }

    let name = args[1];
    if (!name || name.trim() === '') {
      console.error("Branch name cannot be empty");
      process.exit(1);
    }
    name = name.trim();

    let fromIndex = args.indexOf('--from');
    let parentBranchId = fromIndex !== -1 ? args[fromIndex + 1] : null;
    if (parentBranchId) {
      parentBranchId = parentBranchId.trim();
    }

    runTransactional(() => {
      const db = readDb();
      if (db.branches.some(b => b.name === name || b.id === name)) {
        throw new Error(`Branch '${name}' already exists`);
      }

      let forkCommitId = null;
      if (parentBranchId) {
        if (!db.branches.some(b => b.id === parentBranchId || b.name === parentBranchId)) {
          throw new Error(`Parent branch '${parentBranchId}' not found`);
        }
        const parentObj = db.branches.find(b => b.id === parentBranchId || b.name === parentBranchId);
        parentBranchId = parentObj.id;
        forkCommitId = getBranchHeadCommitId(db, parentBranchId);
      }

      const newBranch = {
        id: name,
        name: name,
        parentBranchId: parentBranchId,
        forkCommitId: forkCommitId
      };

      db.branches.push(newBranch);
      writeDb(db);
    });
    process.exit(0);
  }

  if (command === 'commit') {
    let branchId = args[1];
    if (!branchId || branchId.trim() === '') {
      console.error("Branch ID cannot be empty");
      process.exit(1);
    }
    branchId = branchId.trim();

    let mIndex = -1;
    let sleepIndex = -1;
    let factsIndex = -1;

    for (let idx = 4; idx < process.argv.length; idx++) {
      if (process.argv[idx] === '-m' && mIndex === -1) {
        mIndex = idx;
      } else if (process.argv[idx] === '--sleep' && sleepIndex === -1) {
        sleepIndex = idx;
      } else if (process.argv[idx] === '--facts' && factsIndex === -1) {
        factsIndex = idx;
      }
    }
    const messageIndex = mIndex !== -1 ? mIndex + 1 : -1;

    let message = null;
    if (mIndex !== -1) {
      if (messageIndex >= process.argv.length) {
        console.error("Missing value for -m flag");
        process.exit(1);
      }
      message = process.argv[messageIndex];
    }

    let facts = [];
    if (factsIndex !== -1) {
      for (let j = factsIndex + 1; j < process.argv.length; j++) {
        if (j !== mIndex && j !== messageIndex && j !== sleepIndex) {
          facts.push(process.argv[j]);
        }
      }
    }

    if (!message || message.trim() === '') {
      console.error("Commit message cannot be empty");
      process.exit(1);
    }

    let newCommit;
    runTransactional(() => {
      const db = readDb();
      const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
      if (!branchObj) {
        throw new Error(`Branch '${branchId}' not found`);
      }

      const branchCommits = db.commits.filter(c => c.branchId === branchObj.id);
      let parentCommit = null;
      if (branchCommits.length > 0) {
        branchCommits.sort((a, b) => b.timestamp - a.timestamp);
        parentCommit = branchCommits[0].id;
      } else if (branchObj.forkCommitId) {
        parentCommit = branchObj.forkCommitId;
      }

      newCommit = {
        id: 'c_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12),
        branchId: branchObj.id,
        message: message,
        facts: facts,
        parentCommit: parentCommit,
        timestamp: Date.now()
      };

      db.commits.push(newCommit);
      writeDb(db);
    });

    console.log(JSON.stringify(newCommit));
    process.exit(0);
  }

  if (command === 'recall') {
    const allowedFlags = ['--sleep'];
    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith('-')) {
        if (!allowedFlags.includes(args[i])) {
          console.error(`Unsupported flag: ${args[i]}`);
          process.exit(1);
        }
      }
    }

    let branchId = args[1];
    if (!branchId || branchId.trim() === '') {
      console.error("Branch ID cannot be empty");
      process.exit(1);
    }
    branchId = branchId.trim();

    let allFacts;
    runTransactional(() => {
      const db = readDb();
      const branchObj = db.branches.find(b => b.id === branchId || b.name === branchId);
      if (!branchObj) {
        throw new Error(`Branch '${branchId}' not found`);
      }
      allFacts = recallFacts(db, branchObj.id);
    });

    console.log(JSON.stringify(allFacts));
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main();
