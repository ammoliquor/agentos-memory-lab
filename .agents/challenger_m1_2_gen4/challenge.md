# Challenge Report — Concurrency and Argument Parsing

This report evaluates the AgentOS Memory Lab database concurrency, locking mechanism, and CLI argument parsing behavior under stress and edge-case inputs.

---

## 1. Challenge Script Execution Results

### 1.1 `tests/challenge_stress.js`

This script contains two test suites:
- **`testDbConcurrency`**: Measures concurrent writes on `lib/db/db.ts` using direct `readDb` and `writeDb` functions.
- **`testCliConcurrency`**: Measures concurrent branch creation using the `memfork` CLI wrapper.

#### A. `testDbConcurrency` (Expected: FAIL)
- **Mechanism**: Spawns 100 concurrent promises. Each promise reads the database, appends a branch, sleeps for a random duration (0-10ms), and writes the modified database back to disk.
- **Behavior**: Because `readDb` and `writeDb` only acquire the lock *during* their individual execution, there is no lock holding *across* the read-and-write operation. As a result, multiple processes read the same state, modify it, and overwrite each other's changes.
- **Observed / Expected Output**: 
  - Expected branches in DB: `101`
  - Actual branches in DB: `2` to `15` (significantly lower due to lost updates).
- **Vulnerability**: Raw `readDb()` and `writeDb()` calls are not transactionally isolated. Developers must use `updateDb()` or transactional helpers to prevent concurrency anomalies.

#### B. `testCliConcurrency` (Expected: PASS)
- **Mechanism**: Concurrently spawns 10 child processes invoking the CLI wrapper `branch(name, from)` to create 10 branches from `main`.
- **Behavior**: The CLI implementation (`scripts/mock-memfork.js`) wraps its commands in `runTransactional()`, which uses a synchronous folder-based lock (`db.json.lock`). Concurrent processes block and poll with a randomized backoff until they acquire the lock, ensuring serialized database updates.
- **Observed / Expected Output**:
  - Expected branches via CLI: `11`
  - Actual branches via CLI: `11` (All branches are correctly created).

---

### 1.2 `tests/challenge_arguments.js`

This script evaluates how the CLI parses facts and branch names starting with hyphens.

#### A. `testHyphenFact` (Expected: PASS)
- **Mechanism**: Creates a branch and commits a fact starting with a hyphen (e.g., `- Use PostgreSQL`).
- **Behavior**: The command parser in `mock-memfork.js` scans options (such as `-m`, `--facts`, `--sleep`) starting from index 4 of `process.argv` (`for (let idx = 4; idx < process.argv.length; idx++)`). Because the hyphenated fact is positioned after the `--facts` flag (at index 7), it is treated as a positional fact parameter rather than a CLI flag.
- **Observed / Expected Output**:
  - Committed facts: `[ '- Use PostgreSQL', 'Normal Fact' ]`
  - Recalled facts: `[ '- Use PostgreSQL', 'Normal Fact' ]`

#### B. `testBranchNameCollision` (Expected: PASS)
- **Mechanism**: Creates a branch named `-m` and commits a message/fact to it.
- **Behavior**:
  - **Branch Creation**: The CLI validation loop for flags starts at index 2 of `args` (`process.argv.slice(2)`), skipping index 1 (the branch name). Thus, the branch name `'-m'` is bypassed and successfully created.
  - **Commit Command**: The CLI parses `commit -m -m "My real message" --facts "Fact 1"`. Since the option scanner starts at index 4, it correctly matches the second `'-m'` as the message flag and `process.argv[3]` (the first `'-m'`) as the branch name.
- **Observed / Expected Output**:
  - Committed message: `My real message`
  - Committed facts: `[ 'Fact 1' ]`

---

## 2. Evaluation of Locking Concurrency and Database Corruption Risks

### 2.1 Locking Concurrency Analysis
1. **In-Process vs. Cross-Process Concurrency**:
   - `lib/db/db.ts` uses an in-memory queue `Promise.resolve()` to serialize operations within the *same* Node process.
   - For *cross-process* synchronization (e.g., multiple concurrent CLI command executions), it uses folder-based lock acquisition (`db.json.lock`).
2. **Lock Recovery Mechanism**:
   - Both `lib/db/db.ts` and `mock-memfork.js` have a stale-lock checking mechanism: if a lock directory is older than 10 seconds, the active process renames it to `.stale.<uuid>` and deletes it, preventing permanent deadlock.

### 2.2 Database Corruption Risks
1. **Partial Write Prevention**:
   - Writes to the database (`writeDbInternal` in `db.ts` and `writeDb` in `mock-memfork.js`) are atomic. They write to a temporary file (`.json.<uuid>.tmp`) first and then use `fs.renameSync`/`fs.rename` to replace the main JSON file. This guarantees that a system crash during writing does not result in a partially written, malformed database.
2. **Auto-Recovery Risk (Potential Data Loss)**:
   - When `readDb` detects a malformed JSON file or a schema validation failure, it renames the corrupted file to `.corrupted.json` and resets the database to a default empty schema:
     ```javascript
     const defaultDb = { branches: [], commits: [], messages: [], mergeProposals: [] };
     ```
   - While this prevents application crashes and allows automatic recovery, it causes immediate and silent loss of active database state.
3. **CLI Argument Parsing Vulnerability (`--sleep`)**:
   - If a user commits a fact containing the string `"--sleep"`, the CLI parser will evaluate `process.argv.includes('--sleep')` as `true` in `mock-memfork.js` and sleep indefinitely:
     ```javascript
     if (process.env.MOCK_MEMFORK_SLEEP || process.argv.includes('--sleep')) {
       await new Promise(() => {});
     }
     ```
   - This leads to a denial of service (DoS) where the calling application hangs until the 10-second wrapper timeout terminates it.
