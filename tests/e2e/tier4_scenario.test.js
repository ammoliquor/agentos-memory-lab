const test = require('node:test');
const assert = require('node:assert');
const { branch, commit, recall } = require('../../lib/memory/memfork.ts');
const { readDb, writeDb, getBranches, getCommits, resetDb } = require('../../lib/db/db.ts');
const { diffFacts, detectConflicts, mergeBranches } = require('../../lib/memory/merge.ts');
const { MultiAgentOrchestrator } = require('../../lib/agents/orchestrator.ts');

const seedMain = { id: 'main', name: 'main', parentBranchId: null };

// mockLlmProvider removed

test.describe('Tier 4: Real-World Application Scenarios', () => {

  test.beforeEach(async () => {
    await resetDb([seedMain]);
  });

  test('Scenario 1: High-Performance Database Decision Flow', async () => {
    await commit('main', 'Init requirement', [
      "Requirement: Select a high-performance database for analytics and transactions"
    ]);

    const orchestrator = new MultiAgentOrchestrator();

    // Fork branches and run agents
    const pipeline = await orchestrator.runParallelPipeline('main', 'Select a high-performance database', {
      researcher: 'research-db',
      critic: 'critic-db',
      builder: 'builder-db'
    });

    const factsResearch = await recall('research-db');
    const factsCritic = await recall('critic-db');

    // Verify facts loaded correctly matching role and keyword database/analytics
    assert.ok(factsResearch.includes("Use PostgreSQL for transactional processing"));
    assert.ok(factsResearch.includes("Use ClickHouse for high-performance analytics"));
    assert.ok(factsCritic.includes("PostgreSQL struggles with high-volume analytics queries"));
    assert.ok(factsCritic.includes("ClickHouse does not support ACID transactions for OLTP"));

    // Diff branches
    const diff = diffFacts(factsResearch, factsCritic);
    assert.ok(diff.uniqueA.includes("Use PostgreSQL for transactional processing"));
    assert.ok(diff.uniqueB.includes("PostgreSQL struggles with high-volume analytics queries"));

    // Merge research-db (succeeds automatic/FF)
    await mergeBranches('research-db', 'main');

    // Merge critic-db (detects conflict)
    await assert.rejects(async () => {
      await mergeBranches('critic-db', 'main');
    }, /Merge conflict detected/);

    // Manual Resolution
    const resolvedFacts = [
      "Use PostgreSQL as transactional database with ClickHouse as an analytical data warehouse"
    ];
    await mergeBranches('critic-db', 'main', resolvedFacts);

    // Merge builder-db (succeeds)
    await mergeBranches('builder-db', 'main');

    const recalledMain = await recall('main');
    assert.ok(recalledMain.includes("Use PostgreSQL as transactional database with ClickHouse as an analytical data warehouse"));
    assert.ok(recalledMain.includes("Deploy PostgreSQL as primary database and sync to ClickHouse for analytics"));
  });

  test('Scenario 2: UI Library Adoption Decision Flow', async () => {
    await commit('main', 'Init requirement', [
      "Requirement: Select a visualization UI library"
    ]);

    const orchestrator = new MultiAgentOrchestrator();

    // Fork branches and run agents
    const pipeline = await orchestrator.runParallelPipeline('main', 'Select a visualization UI library', {
      researcher: 'research-ui',
      critic: 'critic-ui',
      builder: 'builder-ui'
    });

    const factsResearch = await recall('research-ui');
    const factsCritic = await recall('critic-ui');

    assert.ok(factsResearch.includes("Use D3 for custom low-level chart visualizations"));
    assert.ok(factsResearch.includes("Use Recharts for rapid development of standard charts"));
    assert.ok(factsCritic.includes("D3 has a steep learning curve and slow implementation time"));
    assert.ok(factsCritic.includes("Recharts lacks custom layout flexibility for complex visuals"));

    // Merge research-ui into main
    await mergeBranches('research-ui', 'main');

    // Merge critic-ui (detects conflict)
    await assert.rejects(async () => {
      await mergeBranches('critic-ui', 'main');
    }, /Merge conflict detected/);

    // Manual Resolution
    const resolvedFacts = [
      "Use Recharts for primary charts to speed up development, embedding custom D3 components where extreme flexibility is needed"
    ];
    await mergeBranches('critic-ui', 'main', resolvedFacts);

    // Merge builder-ui (succeeds)
    await mergeBranches('builder-ui', 'main');

    const recalledMain = await recall('main');
    assert.ok(recalledMain.includes("Use Recharts for primary charts to speed up development, embedding custom D3 components where extreme flexibility is needed"));
    assert.ok(recalledMain.includes("Use Recharts for standard dashboards and fall back to D3 for custom visualizations"));
  });

  test('Scenario 4.1: The System Design Workshop (Distributed Cache)', async () => {
    await commit('main', 'Init requirement', ["Build highly available key-value store"]);

    const orchestrator = new MultiAgentOrchestrator();

    // Fork and run cache pipeline
    const pipeline = await orchestrator.runParallelPipeline('main', 'Build highly available key-value store', {
      researcher: 'research-cache',
      critic: 'critic-cache',
      builder: 'builder-cache'
    });

    const factsResearch = await recall('research-cache');
    const factsCritic = await recall('critic-cache');

    // Merge research-cache (succeeds)
    await mergeBranches('research-cache', 'main');

    // Merge critic-cache (conflict)
    await assert.rejects(async () => {
      await mergeBranches('critic-cache', 'main');
    }, /Merge conflict detected/);

    // Resolve conflict
    const resolvedFacts = [
      "Use Redis with AOF persistence configured to everysec to balance performance and power-loss protection"
    ];
    await mergeBranches('critic-cache', 'main', resolvedFacts);

    // Merge builder-cache (succeeds)
    await mergeBranches('builder-cache', 'main');

    const recalledMain = await recall('main');
    assert.ok(recalledMain.includes("Use Redis with AOF persistence configured to everysec to balance performance and power-loss protection"));
    assert.ok(recalledMain.includes("Deploy Redis Sentinel on AWS ECS"));
    assert.ok(recalledMain.includes("Configure AOF persistence with everysec policy"));
  });

  test('Scenario 4.2: The Product Feature Pivot (On-Premise to SaaS)', async () => {
    // Commit initial banking facts to main
    await commit('main', 'Base facts', [
      "Target audience: Enterprise banking",
      "Deployment model: On-premise air-gapped installations"
    ]);

    const orchestrator = new MultiAgentOrchestrator();

    // Run pivot agents
    const pipeline = await orchestrator.runParallelPipeline('main', 'Pivot from On-Premise to SaaS model', {
      researcher: 'research-pivot',
      critic: 'critic-pivot',
      builder: 'builder-pivot'
    });

    // Merge research-pivot into main (should fail because of SaaS vs On-premise conflict)
    await assert.rejects(async () => {
      await mergeBranches('research-pivot', 'main');
    }, /Merge conflict detected/);

    // Resolve conflict
    const resolvedFacts = [
      "SaaS model for SME banking, maintaining optional On-premise air-gapped installations for Tier 1 Enterprise banks"
    ];
    await mergeBranches('research-pivot', 'main', resolvedFacts);

    const recalledMain = await recall('main');
    assert.ok(recalledMain.includes("SaaS model for SME banking, maintaining optional On-premise air-gapped installations for Tier 1 Enterprise banks"));
  });

});
