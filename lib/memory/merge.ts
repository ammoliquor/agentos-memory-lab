import { readDb, writeDb, updateDb, writeDbSnapshot } from '../db/db';
import { Commit, Conflict, MergeProposal, DatabaseSchema } from '../types';
import * as crypto from 'crypto';

export type MemoryCommit = Commit;

const CATEGORIES: { [key: string]: string[] } = {
  db: ['postgres', 'postgresql', 'neo4j', 'mongodb', 'sqlite', 'timescaledb', 'clickhouse', 'redis', 'key-value store'],
  ui: ['d3', 'recharts', 'chartjs', 'tailwind', 'bootstrap'],
  lang: ['go', 'python', 'javascript', 'typescript', 'ruby', 'java', 'rust', 'node.js', 'node'],
  deployment: ['on-premise', 'saas', 'air-gapped', 'multi-tenant', 'cloud', 'self-hosted'],
  subject: ['websockets', 'socket.io', 'redis', 'pub/sub', 'connection state', 'replication', 'sentinel', 'persistence', 'aof', 'rdb']
};

const COMPATIBLE_KEYWORD_PAIRS = new Set([
  'websockets|socket.io',
  'socket.io|websockets',
  'websocket|socket.io',
  'socket.io|websocket',
]);

function areCompatibleKeywords(keywordA: string, keywordB: string): boolean {
  return COMPATIBLE_KEYWORD_PAIRS.has(`${keywordA}|${keywordB}`);
}

function mergeConflictLists(a: Conflict[], b: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  const merged: Conflict[] = [];
  for (const conflict of [...a, ...b]) {
    const key = [conflict.factA, conflict.factB].sort().join('||');
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(conflict);
    }
  }
  return merged;
}

function normalizeFact(fact: string): string {
  return fact.toLowerCase().trim().replace(/\.+$/, '');
}

function getCategoryKeywords(fact: string): { category: string, keyword: string }[] {
  const normalized = fact.toLowerCase();
  const found: { category: string, keyword: string }[] = [];
  for (const [catName, keywords] of Object.entries(CATEGORIES)) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace('.', '\\.')}\\b`, 'i');
      if (regex.test(normalized)) {
        found.push({ category: catName, keyword: kw });
      }
    }
  }
  return found;
}

export function diffFacts(factsA: string[], factsB: string[]): { shared: string[], uniqueA: string[], uniqueB: string[] } {
  const normA = factsA.map(normalizeFact);
  const normB = factsB.map(normalizeFact);

  const shared: string[] = [];
  const uniqueA: string[] = [];
  const uniqueB: string[] = [];

  for (const f of factsA) {
    const norm = normalizeFact(f);
    if (normB.includes(norm)) {
      if (!shared.includes(f)) {
        shared.push(f);
      }
    } else {
      uniqueA.push(f);
    }
  }

  for (const f of factsB) {
    const norm = normalizeFact(f);
    if (!normA.includes(norm)) {
      uniqueB.push(f);
    }
  }

  return { shared, uniqueA, uniqueB };
}

export async function detectConflicts(factsA: string[], factsB: string[]): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();

  const addConflict = (factA: string, factB: string, reason: string, severity = 'HIGH') => {
    const key = [factA, factB].sort().join('||');
    if (!seen.has(key)) {
      seen.add(key);
      conflicts.push({ factA, factB, reason, severity });
    }
  };

  const negationWords = ['do not', "don't", 'avoid', 'never', 'no', 'cannot', 'conflicts with', 'loses data', 'leakage', 'overhead', 'weakness', 'struggles with'];
  const negationRegex = new RegExp(`\\b(${negationWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

  for (const fA of factsA) {
    for (const fB of factsB) {
      const normA = fA.toLowerCase();
      const normB = fB.toLowerCase();

      // Check if one contains the exact negation of the other (direct contradiction)
      let isNegatedContradiction = false;
      for (const neg of negationWords) {
        const negRegex = new RegExp(`\\b${neg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (negRegex.test(normA) || negRegex.test(normB)) {
          const cleanA = normA.replace(negRegex, '').replace(/\s+/g, ' ').trim();
          const cleanB = normB.replace(negRegex, '').replace(/\s+/g, ' ').trim();
          if (cleanA === cleanB) {
            isNegatedContradiction = true;
            break;
          }
        }
      }

      if (isNegatedContradiction) {
        addConflict(fA, fB, 'Direct logical negation or contradiction detected.', 'HIGH');
        continue;
      }

      const kwsA = getCategoryKeywords(fA);
      const kwsB = getCategoryKeywords(fB);

      // Check if they share a subject/technology and one contains warning/weakness/negation words while the other is assertive
      const sharedKws = kwsA.filter(kA => kwsB.some(kB => kB.keyword === kA.keyword));
      if (sharedKws.length > 0) {
        const hasNegationA = negationRegex.test(normA);
        const hasNegationB = negationRegex.test(normB);

        if ((hasNegationA && !hasNegationB) || (!hasNegationA && hasNegationB)) {
          addConflict(
            fA,
            fB,
            `Semantic contradiction identified around shared subject: "${sharedKws[0].keyword}"`,
            'HIGH'
          );
          continue;
        }
      }

      // Check if they belong to the same category but have different keywords (mutually exclusive choices)
      for (const kA of kwsA) {
        for (const kB of kwsB) {
          if (kA.category === kB.category && kA.keyword !== kB.keyword) {
            if (areCompatibleKeywords(kA.keyword, kB.keyword)) {
              continue;
            }

            const catKwsA = kwsA.filter(k => k.category === kA.category);
            const catKwsB = kwsB.filter(k => k.category === kB.category);
            if (catKwsA.length !== 1 || catKwsB.length !== 1) {
              continue;
            }

            const replacedA = normA.replace(new RegExp(`\\b${kA.keyword.replace('.', '\\.')}\\b`, 'g'), '<K>');
            const replacedB = normB.replace(new RegExp(`\\b${kB.keyword.replace('.', '\\.')}\\b`, 'g'), '<K>');

            const wordsA = replacedA.split(/\W+/).filter(Boolean);
            const wordsB = replacedB.split(/\W+/).filter(Boolean);
            const setA = new Set(wordsA);
            const setB = new Set(wordsB);
            const intersection = wordsA.filter(w => setB.has(w));
            const union = new Set([...wordsA, ...wordsB]);
            const similarity = intersection.length / union.size;

            const choiceVerbs = ['use', 'write', 'deploy', 'model', 'library', 'backend', 'implement', 'select', 'adopt', 'development'];
            const hasChoiceA = choiceVerbs.some(v => normA.includes(v));
            const hasChoiceB = choiceVerbs.some(v => normB.includes(v));

            if (similarity > 0.4 || (hasChoiceA && hasChoiceB)) {
              addConflict(
                fA,
                fB,
                `Mutually exclusive choice detected in category "${kA.category}": "${kA.keyword}" vs "${kB.keyword}"`,
                'HIGH'
              );
            }
          }
        }
      }

      // Explicit deployment architecture check: SaaS/Multi-tenant vs Air-gapped/On-premise
      const isSaaS_A = normA.includes('saas') || normA.includes('multi-tenant');
      const isSaaS_B = normB.includes('saas') || normB.includes('multi-tenant');
      const isOnPrem_A = normA.includes('air-gapped') || normA.includes('on-premise');
      const isOnPrem_B = normB.includes('air-gapped') || normB.includes('on-premise');

      if ((isSaaS_A && isOnPrem_B) || (isSaaS_B && isOnPrem_A)) {
        addConflict(
          fA,
          fB,
          `Conflict between cloud SaaS/multi-tenant model and local on-premise/air-gapped deployment model`,
          'HIGH'
        );
      }
    }
  }

  return conflicts;
}

function getBranchHeadCommitId(branchId: string, db: DatabaseSchema): string | null {
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
  const visitedBranches = new Set<string>([branchObj.id]);
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

function getAncestorCommits(startCommitId: string | null, db: DatabaseSchema): Commit[] {
  if (!startCommitId) return [];
  const commitMap = new Map<string, Commit>();
  for (const c of db.commits) {
    commitMap.set(c.id, c);
  }

  const visited = new Set<string>();
  const list: Commit[] = [];
  const queue: string[] = [startCommitId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
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
          const parentStartId = branchObj.forkCommitId || getBranchHeadCommitId(branchObj.parentBranchId, db);
          if (parentStartId && !visited.has(parentStartId)) {
            queue.push(parentStartId);
          }
        }
      }
    }
  }
  return list.sort((a, b) => a.timestamp - b.timestamp);
}

export function recallFacts(branchId: string, db: DatabaseSchema): string[] {
  const headCommitId = getBranchHeadCommitId(branchId, db);
  if (!headCommitId) return [];

  const activeNormalized = new Set<string>();
  const originalCaseMap = new Map<string, string>();

  const ancestors = getAncestorCommits(headCommitId, db).sort((a, b) => a.timestamp - b.timestamp);

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

  return Array.from(activeNormalized).map(norm => originalCaseMap.get(norm)!);
}

export async function mergeBranches(
  sourceBranchId: string,
  targetBranchId: string,
  resolvedFacts: string[] = []
): Promise<Commit> {
  let createdCommit: Commit | undefined;

  await updateDb(async (db) => {
    const sourceBranch = db.branches.find(b => b.id === sourceBranchId || b.name === sourceBranchId);
    const targetBranch = db.branches.find(b => b.id === targetBranchId || b.name === targetBranchId);

    if (!sourceBranch) {
      throw new Error(`Source branch '${sourceBranchId}' not found`);
    }
    if (!targetBranch) {
      throw new Error(`Target branch '${targetBranchId}' not found`);
    }

    const factsSource = recallFacts(sourceBranch.id, db);
    const factsTarget = recallFacts(targetBranch.id, db);

    const diff = diffFacts(factsTarget, factsSource);
    const uniqueConflicts = await detectConflicts(diff.uniqueA, diff.uniqueB);
    const incomingConflicts = diff.uniqueB.length > 0
      ? await detectConflicts(factsTarget, diff.uniqueB)
      : [];
    const conflicts = mergeConflictLists(uniqueConflicts, incomingConflicts);

    if (conflicts.length > 0 && (!resolvedFacts || resolvedFacts.length === 0)) {
      const proposal: MergeProposal = {
        id: 'mp_' + crypto.randomUUID().replace(/-/g, '').substring(0, 9),
        sourceBranchId: sourceBranch.id,
        targetBranchId: targetBranch.id,
        status: 'CONFLICT',
        conflicts,
        timestamp: Date.now()
      };

      if (!db.mergeProposals) {
        db.mergeProposals = [];
      }
      db.mergeProposals.push(proposal);
      await writeDbSnapshot(db);

      throw new Error(`Merge conflict detected between ${sourceBranch.id} and ${targetBranch.id}`);
    }

    let mergeFacts: string[] = [];
    if (conflicts.length > 0) {
      const conflictingSourceFacts = new Set(conflicts.map(c => c.factB));
      const nonConflictingSourceFacts = diff.uniqueB.filter(f => !conflictingSourceFacts.has(f));

      const mergedSet = new Set([
        ...resolvedFacts,
        ...nonConflictingSourceFacts
      ]);
      mergeFacts = Array.from(mergedSet);
    } else {
      mergeFacts = diff.uniqueB;
    }

    const targetHeadId = getBranchHeadCommitId(targetBranch.id, db);
    const sourceHeadId = getBranchHeadCommitId(sourceBranch.id, db);

    let parentCommitStr: string | null = null;
    if (targetHeadId && sourceHeadId) {
      parentCommitStr = `${targetHeadId},${sourceHeadId}`;
    } else if (targetHeadId) {
      parentCommitStr = targetHeadId;
    } else if (sourceHeadId) {
      parentCommitStr = sourceHeadId;
    }

    let retractions: string[] | undefined;
    if (conflicts.length > 0) {
      const allConflicting = new Set<string>();
      for (const c of conflicts) {
        allConflicting.add(c.factA);
        allConflicting.add(c.factB);
      }
      retractions = Array.from(allConflicting);
    }

    const mergeCommit: Commit = {
      id: 'c_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12),
      branchId: targetBranch.id,
      message: `Merge branch '${sourceBranch.id}' into '${targetBranch.id}'`,
      facts: mergeFacts,
      parentCommit: parentCommitStr,
      timestamp: Date.now(),
      ...(retractions ? { retractions } : {})
    };

    db.commits.push(mergeCommit);

    if (conflicts.length > 0) {
      const proposal: MergeProposal = {
        id: 'mp_' + crypto.randomUUID().replace(/-/g, '').substring(0, 9),
        sourceBranchId: sourceBranch.id,
        targetBranchId: targetBranch.id,
        status: 'RESOLVED',
        conflicts: [],
        timestamp: Date.now()
      };
      if (!db.mergeProposals) {
        db.mergeProposals = [];
      }
      db.mergeProposals.push(proposal);
    }

    createdCommit = mergeCommit;
  });

  if (!createdCommit) {
    throw new Error('Merge failed to produce a commit');
  }
  return createdCommit;
}
