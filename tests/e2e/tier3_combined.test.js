const test = require('node:test');
const assert = require('node:assert');
const { branch, commit, recall } = require('../../lib/memory/memfork.ts');
const { readDb, writeDb, getBranches, getCommits, resetDb, getMessages, addMessage } = require('../../lib/db/db.ts');
const { diffFacts, detectConflicts, mergeBranches } = require('../../lib/memory/merge.ts');
const { MultiAgentOrchestrator } = require('../../lib/agents/orchestrator.ts');

const seedMain = { id: 'main', name: 'main', parentBranchId: null };

// mockLlmProvider removed

test.describe('Tier 3: Cross-Feature Combinations', () => {

  test.beforeEach(async () => {
    await resetDb([seedMain]);
  });

  test('Parallel Agent Fork, Commit, and Synthesized Merge Pipeline', async () => {
    await commit('main', 'Requirement', ['Build a chat app']);

    const orchestrator = new MultiAgentOrchestrator();

    const pipeline = await orchestrator.runParallelPipeline('main', 'Build a chat app', {
      researcher: 'research-agent',
      critic: 'critic-agent',
      builder: 'builder-agent'
    });

    assert.ok(pipeline.researcher);
    assert.ok(pipeline.critic);
    assert.ok(pipeline.builder);

    const branches = await getBranches();
    const branchIds = branches.map(b => b.id);
    assert.ok(branchIds.includes('research-agent'));
    assert.ok(branchIds.includes('critic-agent'));
    assert.ok(branchIds.includes('builder-agent'));

    const commits = await getCommits();
    assert.ok(commits.some(c => c.branchId === 'research-agent'));
    assert.ok(commits.some(c => c.branchId === 'critic-agent'));
    assert.ok(commits.some(c => c.branchId === 'builder-agent'));
  });

  test('Double Merge with Semantic Conflict Resolution', async () => {
    await commit('main', 'Requirement', ['Build a chat app']);

    const orchestrator = new MultiAgentOrchestrator();
    await orchestrator.runParallelPipeline('main', 'Build a chat app', {
      researcher: 'research-agent',
      critic: 'critic-agent',
      builder: 'builder-agent'
    });

    const factsResearch = await recall('research-agent');
    const factsCritic = await recall('critic-agent');

    const diff = diffFacts(factsResearch, factsCritic);
    assert.ok(diff);

    await mergeBranches('research-agent', 'main');

    await assert.rejects(async () => {
      await mergeBranches('critic-agent', 'main');
    }, /Merge conflict detected/);

    const resolvedFacts = [
      "Use WebSockets for real-time messages, configured with scale-out adapter to manage connection state overhead"
    ];
    await mergeBranches('critic-agent', 'main', resolvedFacts);

    await mergeBranches('builder-agent', 'main');

    const recalledMain = await recall('main');
    assert.ok(recalledMain.includes("Use WebSockets for real-time messages, configured with scale-out adapter to manage connection state overhead"));
    assert.ok(recalledMain.includes("Implement server in Node.js with socket.io"));
  });

  test('Branching from Merged Pointers', async () => {
    await commit('main', 'Requirement', ['Build a chat app']);

    const orchestrator = new MultiAgentOrchestrator();
    await orchestrator.runParallelPipeline('main', 'Build a chat app', {
      researcher: 'research-agent',
      critic: 'critic-agent',
      builder: 'builder-agent'
    });

    await mergeBranches('research-agent', 'main');
    await mergeBranches('critic-agent', 'main', [
      "Use WebSockets for real-time messages, configured with scale-out adapter to manage connection state overhead"
    ]);

    await branch('v2-design', 'main');
    const recalledV2 = await recall('v2-design');

    assert.ok(recalledV2.includes("Use WebSockets for real-time messages, configured with scale-out adapter to manage connection state overhead"));
  });

  test('Interactive Chat Message Flow Syncing with CLI & DB', async () => {
    const msg1 = {
      id: 'm1',
      branchId: 'main',
      role: 'user',
      content: 'What database options are available?',
      timestamp: Date.now()
    };
    const msg2 = {
      id: 'm2',
      branchId: 'main',
      role: 'assistant',
      content: 'PostgreSQL, Neo4j, MongoDB, SQLite.',
      agentType: 'researcher',
      timestamp: Date.now() + 100
    };

    await addMessage(msg1);
    await addMessage(msg2);

    const messages = await getMessages('main');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].content, 'What database options are available?');
    assert.strictEqual(messages[1].agentType, 'researcher');
  });

  test('Concurrent Multi-Branch CLI Access Stress Test', async () => {
    const branchPrefix = 'stress-br-';
    const numBranches = 10;

    const branchPromises = [];
    for (let i = 0; i < numBranches; i++) {
      branchPromises.push(branch(`${branchPrefix}${i}`, 'main'));
    }
    await Promise.all(branchPromises);

    const commitPromises = [];
    for (let i = 0; i < numBranches; i++) {
      commitPromises.push(commit(`${branchPrefix}${i}`, `Stress commit ${i}`, [`Fact stress ${i}`]));
    }
    await Promise.all(commitPromises);

    const db = await readDb();
    assert.strictEqual(db.branches.length, numBranches + 1);

    for (let i = 0; i < numBranches; i++) {
      const recalled = await recall(`${branchPrefix}${i}`);
      assert.deepStrictEqual(recalled, [`Fact stress ${i}`]);
    }
  });

  test('Ancestry Fact Aggregation (Deep DAG)', async () => {
    await commit('main', 'msg-main', ['Fact main']);
    await branch('b1', 'main');
    await commit('b1', 'msg-1', ['Fact 1']);
    await branch('b2', 'b1');
    await commit('b2', 'msg-2', ['Fact 2']);
    await branch('b3', 'b2');
    await commit('b3', 'msg-3', ['Fact 3']);
    await branch('b4', 'b3');
    await commit('b4', 'msg-4', ['Fact 4']);
    await branch('b5', 'b4');
    await commit('b5', 'msg-5', ['Fact 5']);

    const recalled = await recall('b5');
    assert.deepStrictEqual(recalled, [
      'Fact main',
      'Fact 1',
      'Fact 2',
      'Fact 3',
      'Fact 4',
      'Fact 5'
    ]);
  });

  test('Conflict Proposal Escalation & Resolution Flow', async () => {
    await branch('source-br', 'main');
    await branch('target-br', 'main');

    await commit('source-br', 'commit-s', ['Use PostgreSQL']);
    await commit('target-br', 'commit-t', ['Do not use PostgreSQL']);

    await assert.rejects(async () => {
      await mergeBranches('source-br', 'target-br');
    }, /Merge conflict detected/);

    const dbAfterConflict = await readDb();
    assert.ok(dbAfterConflict.mergeProposals.length > 0);
    const proposal = dbAfterConflict.mergeProposals[0];
    assert.strictEqual(proposal.status, 'CONFLICT');
    assert.strictEqual(proposal.conflicts.length, 1);
    assert.strictEqual(proposal.conflicts[0].factA, 'Do not use PostgreSQL');
    assert.strictEqual(proposal.conflicts[0].factB, 'Use PostgreSQL');

    await mergeBranches('source-br', 'target-br', ['Use PostgreSQL with scaling mitigation']);

    const dbAfterResolution = await readDb();
    const resolvedProposal = dbAfterResolution.mergeProposals.find(p => p.status === 'RESOLVED');
    assert.ok(resolvedProposal);

    const recalledTarget = await recall('target-br');
    assert.ok(recalledTarget.includes('Use PostgreSQL with scaling mitigation'));
  });

});
