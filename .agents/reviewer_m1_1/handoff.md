# Handoff Report — Milestone 1 Reviewer 1

## 1. Observation
- **JSON DB Helper**: `lib/db/db.ts` lines 14-29 defines the promise queue helper:
  ```typescript
  let queue = Promise.resolve();
  async function enqueue<T>(task: () => Promise<T>): Promise<T> { ... }
  ```
  And lines 122-129 defines `addBranch`:
  ```typescript
  export async function addBranch(branch: Branch): Promise<void> {
    const db = await readDb();
    if (db.branches.some(b => b.name === branch.name || b.id === branch.id)) {
      throw new Error(`Branch with name "${branch.name}" or ID "${branch.id}" already exists`);
    }
    db.branches.push(branch);
    await writeDb(db);
  }
  ```
- **Concurrency Test Case**: `tests/e2e/tier2_boundary.test.js` lines 119-136 defines the concurrent branch writes:
  ```javascript
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
    assert.strictEqual(finalDb.branches.length, 100 + 1);
  ```
- **Branch Recall Logic**: `scripts/mock-memfork.js` lines 183-194:
  ```javascript
  const allFacts = [];
  for (const bId of pathIds) {
    const branchCommits = db.commits.filter(c => c.branchId === bId);
    branchCommits.sort((a, b) => a.timestamp - b.timestamp);
    for (const commit of branchCommits) {
      for (const fact of commit.facts) {
        if (!allFacts.includes(fact)) {
          allFacts.push(fact);
        }
      }
    }
  }
  ```
- **CLI Fact Parsing**: `scripts/mock-memfork.js` line 128:
  ```javascript
  if (args[i].startsWith('-')) break;
  ```

---

## 2. Logic Chain
- **Lost Update Race**: 
  - From the observation in `lib/db/db.ts`, `enqueue` executes tasks sequentially.
  - From `addBranch` implementation, the read (`readDb()`) and write (`writeDb()`) are called as separate async tasks.
  - In `Test Case 2.6.2`, 100 loops run synchronously and trigger `readDb` calls. These 100 read tasks are added to the queue first.
  - When the reads finish, they all return the same original DB object (since no writes have occurred yet).
  - Then the writes are added to the queue.
  - Each write overwrites the previous write. The last write wins, resulting in a database containing only `main` and `branch-99`.
  - Therefore, `finalDb.branches.length` equals `2` instead of `101`, and the test case fails.
- **Branch Isolation Violation**: 
  - From the observation in `mock-memfork.js`, the recall logic pulls *all* commits on parent branches in `pathIds`.
  - It does not verify whether the commit was added before or after the child branch was branched.
  - Therefore, child branches automatically inherit modifications added to parents after the branching event, violating isolation.
- **Fact Truncation**:
  - From the parsing block in `mock-memfork.js`, if a fact starts with `-`, it triggers the break statement. This truncates any fact starting with `-`.

---

## 3. Caveats
- No direct execution verification could be done because the environment timed out on command permission prompts.
- We assume standard Node.js module resolution applies, which is supported by typescript loader configs in `scripts/run-e2e.js`.

---

## 4. Conclusion
- **Verdict**: REQUEST_CHANGES
- **Rationale**: The database helper must wrap read-modify-write operations in a single atomic task, the recall function must trace history via parentCommit pointers in the DAG rather than branch ID queries, and mock CLI argument parsing must handle dashed facts.

---

## 5. Verification Method
1. Run the verification script:
   ```powershell
   node scripts/verify-project.js
   ```
2. Observe if `Test Case 2.6.2: Parallel write lockouts (100 writes)` fails. (It is predicted to fail due to lost updates, returning length 2 instead of 101).
3. Inspect `lib/db/db.ts` to see that `readDb` and `writeDb` are enqueued as separate microtasks in update functions.
