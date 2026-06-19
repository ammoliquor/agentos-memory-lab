const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { branch, commit, recall } = require('../../lib/memory/memfork.ts');
const { readDb, writeDb, getBranches, getCommits, resetDb } = require('../../lib/db/db.ts');
const { mergeBranches } = require('../../lib/memory/merge.ts');

const seedMain = { id: 'main', name: 'main', parentBranchId: null };

test.describe('Tier 2: Boundary & Corner Cases (DB & CLI Wrapper)', () => {
  
  test.beforeEach(async () => {
    await resetDb([seedMain]);
  });

  test.describe('1. Empty Inputs', () => {
    test('Test Case 2.1.1: Empty branch name', async () => {
      await assert.rejects(async () => {
        await branch('', 'main');
      }, /Branch name cannot be empty/);

      await assert.rejects(async () => {
        await branch('   ', 'main');
      }, /Branch name cannot be empty/);
    });

    test('Test Case 2.1.2: Empty fact list commit', async () => {
      await branch('feature-a', 'main');
      const c = await commit('feature-a', 'No facts commit', []);
      assert.deepStrictEqual(c.facts, []);
      const recalled = await recall('feature-a');
      assert.deepStrictEqual(recalled, []);
    });

    test('Test Case 2.1.3: Empty commit message', async () => {
      await branch('feature-a', 'main');
      await assert.rejects(async () => {
        await commit('feature-a', '', ['some fact']);
      }, /Commit message cannot be empty/);

      await assert.rejects(async () => {
        await commit('feature-a', '   ', ['some fact']);
      }, /Commit message cannot be empty/);
    });

    test('Test Case 2.1.4: Branch name with leading/trailing whitespace', async () => {
      await branch('  whitespace-branch  ', 'main');
      const branches = await getBranches();
      assert.ok(branches.some(b => b.name === 'whitespace-branch'));

      await commit('  whitespace-branch  ', 'whitespace commit', ['whitespace-fact']);
      const recalled = await recall('  whitespace-branch  ');
      assert.deepStrictEqual(recalled, ['whitespace-fact']);
    });
  });

  test.describe('2. Duplicate Names & Records', () => {
    test('Test Case 2.2.1: Re-creating existing branch', async () => {
      await branch('feature-a', 'main');
      await assert.rejects(async () => {
        await branch('feature-a', 'main');
      }, /already exists/);
    });

    test('Test Case 2.2.2: Re-submitting identical facts', async () => {
      await branch('feature-a', 'main');
      await commit('feature-a', 'Commit 1', ['Use Postgres']);
      await commit('feature-a', 'Commit 2', ['Use Postgres']);
      const recalled = await recall('feature-a');
      assert.deepStrictEqual(recalled, ['Use Postgres']); // unique check
    });

    test('Test Case 2.2.3: Duplicate facts in the same commit', async () => {
      await branch('feature-dup', 'main');
      await commit('feature-dup', 'Commit 1', ['Use Postgres', 'Use Postgres', 'Use MongoDB']);
      const recalled = await recall('feature-dup');
      assert.deepStrictEqual(recalled, ['Use Postgres', 'Use MongoDB']);
    });

    test('Test Case 2.2.4: Case-sensitivity of branch names', async () => {
      await branch('dev', 'main');
      await branch('DEV', 'main');
      
      const branches = await getBranches();
      const names = branches.map(b => b.name);
      assert.ok(names.includes('dev'));
      assert.ok(names.includes('DEV'));
    });
  });

  test.describe('3. Invalid Parents & Lineage', () => {
    test('Test Case 2.3.1: Branch from non-existent parent', async () => {
      await assert.rejects(async () => {
        await branch('new-branch', 'ghost-parent');
      }, /Parent branch 'ghost-parent' not found/);
    });

    test('Test Case 2.3.2: Commit to non-existent branch', async () => {
      await assert.rejects(async () => {
        await commit('ghost-branch', 'commit msg', ['fact']);
      }, /Branch 'ghost-branch' not found/);
    });

    test('Test Case 2.3.3: Commit to parent branch that has no commits', async () => {
      await branch('child-b', 'main');
      const cParent = await commit('main', 'Parent commit', ['parent-fact']);
      assert.strictEqual(cParent.parentCommit, null);

      const cChild = await commit('child-b', 'Child commit', ['child-fact']);
      assert.strictEqual(cChild.parentCommit, null);

      const recalledChild = await recall('child-b');
      assert.deepStrictEqual(recalledChild, ['parent-fact', 'child-fact']);
    });

    test('Test Case 2.3.4: Recall branch on database with cyclic references', async () => {
      const db = await readDb();
      db.branches.push({ id: 'cycle-1', name: 'cycle-1', parentBranchId: 'cycle-2' });
      db.branches.push({ id: 'cycle-2', name: 'cycle-2', parentBranchId: 'cycle-1' });
      await writeDb(db);

      const recalled = await recall('cycle-1');
      assert.deepStrictEqual(recalled, []);
    });

    test('Test Case 2.3.5: Extremely long branch name', async () => {
      const longName = 'a'.repeat(210);
      await branch(longName, 'main');
      await commit(longName, 'Long name commit', ['long-fact']);
      const recalled = await recall(longName);
      assert.deepStrictEqual(recalled, ['long-fact']);
    });
  });

  test.describe('4. CLI Failures', () => {
    test('Test Case 2.5.1: Missing executable handling', async () => {
      const originalCliPath = process.env.MEMFORK_CLI_PATH;
      process.env.MEMFORK_CLI_PATH = path.resolve('scripts/non-existent-mock.js');
      try {
        await assert.rejects(async () => {
          await branch('new-branch', 'main');
        }, /memfork executable not found/);
      } finally {
        process.env.MEMFORK_CLI_PATH = originalCliPath;
      }
    });

    test('Test Case 2.5.2: CLI execution timeout', async () => {
      process.env.MOCK_MEMFORK_SLEEP = 'true';
      try {
        await assert.rejects(async () => {
          await branch('timeout-branch', 'main');
        }, /CLI execution timeout/);
      } finally {
        delete process.env.MOCK_MEMFORK_SLEEP;
      }
    });

    test('Test Case 2.5.3: CLI command execution with invalid/unsupported CLI flags', async () => {
      const { execCli } = require('../helpers/cli-helper.js');
      const res = await execCli('branch some-branch --invalid-flag');
      assert.notStrictEqual(res.code, 0);
      assert.ok(res.stderr.includes('Unsupported flag') || res.code !== 0);
    });
  });

  test.describe('5. Database Corruption', () => {
    test('Test Case 2.6.1: Malformed JSON recovery', async () => {
      const dbPath = path.resolve('.memfork/db.test.json');
      const corruptedDbPath = path.resolve('.memfork/db.test.corrupted.json');
      if (fs.existsSync(corruptedDbPath)) {
        fs.unlinkSync(corruptedDbPath);
      }
      fs.writeFileSync(dbPath, '{ invalid json', 'utf8');

      const db = await readDb();
      assert.deepStrictEqual(db.branches, []);
      assert.ok(fs.existsSync(corruptedDbPath), 'Corrupted file backup should exist');
      const backupContent = fs.readFileSync(corruptedDbPath, 'utf8');
      assert.strictEqual(backupContent, '{ invalid json');
    });

    test('Test Case 2.6.2: Parallel write lockouts (100 writes)', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push((async () => {
          const db = await readDb();
          db.branches.push({ id: `branch-${i}`, name: `branch-${i}`, parentBranchId: null });
          await writeDb(db);
        })());
      }
      await Promise.all(promises);

      const finalDb = await readDb();
      // Should contain 100 + 1 (main) branches
      assert.strictEqual(finalDb.branches.length, 100 + 1);
      for (let i = 0; i < 100; i++) {
        assert.ok(finalDb.branches.some(b => b.id === `branch-${i}`));
      }
    });

    test('Test Case 2.6.3: Recover DB from empty object {}', async () => {
      const dbPath = path.resolve('.memfork/db.test.json');
      const corruptedDbPath = path.resolve('.memfork/db.test.corrupted.json');
      if (fs.existsSync(corruptedDbPath)) {
        fs.unlinkSync(corruptedDbPath);
      }
      fs.writeFileSync(dbPath, '{}', 'utf8');

      const db = await readDb();
      assert.deepStrictEqual(db.branches, []);
      assert.ok(fs.existsSync(corruptedDbPath), 'Corrupted file backup should exist');
      const backupContent = fs.readFileSync(corruptedDbPath, 'utf8');
      assert.strictEqual(backupContent, '{}');
    });

    test('Test Case 2.6.4: Commit facts containing quotes, special characters, and emojis', async () => {
      await branch('special-facts-branch', 'main');
      const specialFacts = [
        "Fact 🚀",
        "Fact containing 'quotes' and \"double quotes\"",
        "Fact with special $symbols & @characters"
      ];
      const c = await commit('special-facts-branch', 'Special characters commit', specialFacts);
      
      assert.strictEqual(c.branchId, 'special-facts-branch');
      assert.deepStrictEqual(c.facts, specialFacts);
      
      const recalled = await recall('special-facts-branch');
      assert.deepStrictEqual(recalled, specialFacts);
    });

    test('Test Case 2.6.5: Conflict resolution fact tombstoning edge case', async () => {
      await branch('branch-a', 'main');
      await branch('branch-b', 'main');

      await commit('branch-a', 'Commit A', ['Use PostgreSQL']);
      await commit('branch-b', 'Commit B', ['Do not use PostgreSQL']);

      await mergeBranches('branch-a', 'main');

      const resolvedFacts = ['Use PostgreSQL'];
      await mergeBranches('branch-b', 'main', resolvedFacts);

      const recalledMain = await recall('main');
      assert.ok(recalledMain.includes('Use PostgreSQL'), 'Resolved fact should not be tombstoned');
    });
  });
});
