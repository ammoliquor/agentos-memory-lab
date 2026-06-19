# Handoff Report — Milestone 1 Explorer 2 Gen 2

## 1. Observation
We observed the following files and content within the `memfork` repository:
- **`lib/db/db.ts`** (Lines 122-129):
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
- **`scripts/mock-memfork.js`** (Lines 124-131):
  ```javascript
  let factsIndex = args.indexOf('--facts');
  let facts = [];
  if (factsIndex !== -1) {
    for (let i = factsIndex + 1; i < args.length; i++) {
      if (args[i].startsWith('-')) break;
      facts.push(args[i]);
    }
  }
  ```
- **`lib/memory/merge.ts`** (Lines 239-245):
  ```typescript
  let mergeFacts: string[] = [];
  if (conflicts.length > 0) {
    mergeFacts = resolvedFacts.filter(f => !factsTarget.includes(f));
  } else {
    const diff = diffFacts(factsTarget, factsSource);
    mergeFacts = diff.uniqueB;
  }
  ```
- **`lib/memory/memfork.ts`** (Lines 26-29):
  ```typescript
  const child = spawn(executable, spawnArgs, {
    env: { ...process.env },
    shell: process.platform === 'win32'
  });
  ```
- **Review reports**:
  - `reviewer_m1_1\review.md` Finding 1 detailing that 100 concurrent writes fail with race conditions.
  - `reviewer_m1_2\review.md` Finding 4 stating hyphenated facts are parsed as flags and truncated.
  - `challenger_m1_1\challenge.md` Challenge 2 indicating that resolving conflicts deletes all other unique facts in the source branch.
  - `challenger_m1_2\challenge.md` Challenge 2 reporting `EPERM` / `ENOENT` due to concurrent processes using static `db.json.tmp` paths on Windows.

---

## 2. Logic Chain
1. Mutating operations in `db.ts` call `readDb` followed by `writeDb` outside of a single transactional block. This allows concurrent read calls to execute before any writes, causing subsequent writes to overwrite and lose data (supported by Observation of `db.ts` and `reviewer_m1_1\review.md`).
2. Concurrent CLI processes collide on `db.json.tmp` and bypass in-process promises, leading to lockouts on Windows (supported by `challenger_m1_2\challenge.md`). Resolving this requires generating unique temp file names and implementing cross-process locking.
3. Fact recall is currently branch-ID based, meaning parent commits added after a child branch forks are incorrectly recalled. Shifting to DAG-based traversal starting from the head commit and walking `parentCommit` pointers will resolve this branch isolation violation.
4. If a fact starts with a hyphen (like a list bullet point), `mock-memfork.js` parser aborts immediately. Positionally scanning command options statefully avoids flag collisions and supports hyphenated facts.
5. `shell: true` on Windows allows command injection. Disabling `shell` for direct `node` calls and enforcing regex validation `/^[a-zA-Z0-9._/\-]+$/` on branch names mitigates injection. Adding `taskkill` ensures timeout processes are terminated without orphaning.
6. The conflict-handling block in `merge.ts` overwrites `mergeFacts` using only `resolvedFacts`, discarding non-conflicting unique source facts. Preserving them requires filtering unique source facts to exclude those with conflicts, then merging the remainder.
7. Omitting `mergeProposals` validation in `validateSchema` leads to type errors when files lack the field. Adding array and structure checks with legacy defaults ensures type-safety.

---

## 3. Caveats
- No actual code writes were made since this is a read-only investigation constraint.
- The advisory locking mechanism is designed to use exclusive `flag: 'wx'` file writing. While highly portable and effective across POSIX and Windows Node runtimes, it assumes the project folder has write permissions.

---

## 4. Conclusion
A detailed, comprehensive, and actionable fix strategy addressing all seven core issues (concurrency race conditions, process conflicts, DAG traversal, command injection, parser truncation, data loss on conflict resolution, and schema validation) has been formulated and written to `.agents/explorer_m1_2_gen2/analysis.md`.

---

## 5. Verification Method
1. Inspect the detailed proposals in `.agents/explorer_m1_2_gen2/analysis.md`.
2. Once the implementer applies the changes, run the project's E2E test command (e.g. `npm test` or `node scripts/run-e2e.js`) to verify concurrency correctness, argument parsing, and conflict resolutions.
3. Validation fails if concurrent writes result in lost updates or if hyphenated facts fail to be stored.
