const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { branch, commit, recall } = require('../../lib/memory/memfork.ts');
const { readDb, writeDb, getBranches, getCommits, resetDb } = require('../../lib/db/db.ts');

const seedMain = { id: 'main', name: 'main', parentBranchId: null };

test.describe('Tier 1: Feature Coverage (DB & CLI Wrapper)', () => {
  
  test.beforeEach(async () => {
    // Reset database with 'main' branch seed before each test
    await resetDb([seedMain]);
  });

  test.describe('1. Branching', () => {
    test('Test Case 1.1: Create branch from main', async () => {
      await branch('feature-a', 'main');
      const branches = await getBranches();
      const featureA = branches.find(b => b.id === 'feature-a');
      assert.ok(featureA, 'Branch feature-a should exist');
      assert.strictEqual(featureA.parentBranchId, 'main');
    });

    test('Test Case 1.2: Transitive branching (branch from child)', async () => {
      await branch('feature-a', 'main');
      await branch('feature-b', 'feature-a');
      const branches = await getBranches();
      const featureB = branches.find(b => b.id === 'feature-b');
      assert.ok(featureB, 'Branch feature-b should exist');
      assert.strictEqual(featureB.parentBranchId, 'feature-a');
    });

    test('Test Case 1.3: List branches', async () => {
      await branch('feature-a', 'main');
      await branch('feature-b', 'feature-a');
      const branches = await getBranches();
      const names = branches.map(b => b.name);
      assert.ok(names.includes('main'));
      assert.ok(names.includes('feature-a'));
      assert.ok(names.includes('feature-b'));
    });

    test('Test Case 1.4: Special character branch names', async () => {
      const name = 'feat/some-user_request-1';
      await branch(name, 'main');
      const branches = await getBranches();
      const specialBranch = branches.find(b => b.name === name);
      assert.ok(specialBranch, 'Special character branch should be created');
      assert.strictEqual(specialBranch.id, name);
    });

    test('Test Case 1.5: Branch retrieval by name', async () => {
      await branch('feature-a', 'main');
      const branches = await getBranches();
      const featureA = branches.find(b => b.name === 'feature-a');
      assert.strictEqual(featureA.id, 'feature-a');
      assert.strictEqual(featureA.parentBranchId, 'main');
    });
  });

  test.describe('2. Committing', () => {
    test('Test Case 2.1: First commit to branch', async () => {
      await branch('feature-a', 'main');
      const c = await commit('feature-a', 'Initial design', ['Add core DB']);
      assert.strictEqual(c.branchId, 'feature-a');
      assert.strictEqual(c.message, 'Initial design');
      assert.deepStrictEqual(c.facts, ['Add core DB']);
      assert.strictEqual(c.parentCommit, null);
    });

    test('Test Case 2.2: Sequential commits', async () => {
      await branch('feature-a', 'main');
      const c1 = await commit('feature-a', 'Initial design', ['Add core DB']);
      const c2 = await commit('feature-a', 'Add CLI', ['Use child_process']);
      assert.strictEqual(c2.parentCommit, c1.id);
      assert.deepStrictEqual(c2.facts, ['Use child_process']);
    });

    test('Test Case 2.3: Multi-fact commit', async () => {
      await branch('feature-a', 'main');
      const c = await commit('feature-a', 'Bulk facts', ['Fact 1', 'Fact 2', 'Fact 3']);
      assert.deepStrictEqual(c.facts, ['Fact 1', 'Fact 2', 'Fact 3']);
    });

    test('Test Case 2.4: Fast-forward sequence', async () => {
      await branch('feature-a', 'main');
      const c1 = await commit('feature-a', 'Commit 1', ['Fact 1']);
      const c2 = await commit('feature-a', 'Commit 2', ['Fact 2']);
      const c3 = await commit('feature-a', 'Commit 3', ['Fact 3']);
      assert.strictEqual(c2.parentCommit, c1.id);
      assert.strictEqual(c3.parentCommit, c2.id);
      assert.ok(c2.timestamp >= c1.timestamp);
      assert.ok(c3.timestamp >= c2.timestamp);
    });

    test('Test Case 2.5: Commit object validation', async () => {
      await branch('feature-a', 'main');
      const c = await commit('feature-a', 'Validation test', ['Fact']);
      assert.strictEqual(typeof c.id, 'string');
      assert.ok(c.id.startsWith('c_'));
      assert.strictEqual(typeof c.timestamp, 'number');
      assert.ok(Array.isArray(c.facts));
    });
  });

  test.describe('3. Recalling', () => {
    test('Test Case 3.1: Recall empty branch', async () => {
      await branch('feature-a', 'main');
      const facts = await recall('feature-a');
      assert.deepStrictEqual(facts, []);
    });

    test('Test Case 3.2: Recall single commit', async () => {
      await branch('feature-a', 'main');
      await commit('feature-a', 'Initial design', ['Add core DB']);
      const facts = await recall('feature-a');
      assert.deepStrictEqual(facts, ['Add core DB']);
    });

    test('Test Case 3.3: Recall accumulated commits', async () => {
      await branch('feature-a', 'main');
      await commit('feature-a', 'Initial design', ['Add core DB']);
      await commit('feature-a', 'Add CLI', ['Use child_process']);
      const facts = await recall('feature-a');
      assert.deepStrictEqual(facts, ['Add core DB', 'Use child_process']);
    });

    test('Test Case 3.4: Recall child branch inheriting parent', async () => {
      await branch('feature-a', 'main');
      await commit('feature-a', 'Initial design', ['Add core DB']);
      await commit('feature-a', 'Add CLI', ['Use child_process']);
      await branch('feature-b', 'feature-a');
      const facts = await recall('feature-b');
      assert.deepStrictEqual(facts, ['Add core DB', 'Use child_process']);
    });

    test('Test Case 3.5: Recall isolation', async () => {
      await branch('feature-a', 'main');
      await commit('feature-a', 'Initial design', ['Add core DB']);
      await branch('feature-b', 'feature-a');
      await commit('feature-b', 'Unique feature-b fact', ['B Fact']);
      
      const factsA = await recall('feature-a');
      const factsB = await recall('feature-b');
      
      assert.deepStrictEqual(factsA, ['Add core DB']);
      assert.deepStrictEqual(factsB, ['Add core DB', 'B Fact']);
    });
  });

  test.describe('4. DB Persistence', () => {
    test('Test Case 4.1: Auto-initialization', async () => {
      const dbPath = path.resolve('.memfork/db.test.json');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      const db = await readDb();
      assert.deepStrictEqual(db.branches, []);
      assert.deepStrictEqual(db.commits, []);
      assert.deepStrictEqual(db.messages, []);
      assert.ok(fs.existsSync(dbPath));
    });

    test('Test Case 4.2: Atomic writes', async () => {
      const db = await readDb();
      db.branches.push({ id: 'temp-branch', name: 'temp-branch', parentBranchId: null });
      await writeDb(db);
      const updatedDb = await readDb();
      assert.ok(updatedDb.branches.some(b => b.id === 'temp-branch'));
    });

    test('Test Case 4.3: Session survival', async () => {
      const db = await readDb();
      db.messages.push({
        id: 'msg_1',
        branchId: 'main',
        role: 'user',
        content: 'Hello World',
        timestamp: Date.now()
      });
      await writeDb(db);
      
      const refreshedDb = await readDb();
      const msg = refreshedDb.messages.find(m => m.id === 'msg_1');
      assert.ok(msg);
      assert.strictEqual(msg.content, 'Hello World');
    });

    test('Test Case 4.4: Concurrent reads and writes', async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push((async () => {
          const db = await readDb();
          db.branches.push({ id: `branch-${i}`, name: `branch-${i}`, parentBranchId: null });
          await writeDb(db);
        })());
      }
      await Promise.all(promises);

      const finalDb = await readDb();
      assert.strictEqual(finalDb.branches.length, 20 + 1); // 20 + main seed
      for (let i = 0; i < 20; i++) {
        assert.ok(finalDb.branches.some(b => b.id === `branch-${i}`));
      }
    });

    test('Test Case 4.5: Validation on write', async () => {
      const invalidDb = {
        branches: [{ id: 'b', name: 'b', parentBranchId: null }],
        commits: [{ id: 'c', branchId: 'b', message: 'msg', facts: null, parentCommit: null, timestamp: 'invalid' }],
        messages: []
      };
      
      await assert.rejects(async () => {
        await writeDb(invalidDb);
      }, /Invalid database schema/);
    });
  });
});
