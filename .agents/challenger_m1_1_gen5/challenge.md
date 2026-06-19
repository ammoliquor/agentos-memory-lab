# Challenge Report — Concurrency and Argument Parsing

## Challenge Summary

**Overall risk assessment**: HIGH

While the CLI implementation contains a robust directory-based synchronous transaction lock (`runTransactional`) that successfully prevents race conditions during concurrent CLI invocations, the library-level API (`lib/db/db.ts`) does not enforce atomic transactions when `readDb` and `writeDb` are called independently. This creates a critical risk of data loss and database corruption in multi-threaded or concurrent asynchronous environments.

Furthermore, command line argument parsing in `scripts/mock-memfork.js` is highly fragile and positional, introducing vulnerabilities to command collisions (such as with the branch name `"-m"`) and hangs due to parameter injection (such as a fact named `"--sleep"`).

---

## Stress Test Results

### 1. Database Concurrency (`testDbConcurrency`)
- **Scenario**: 100 concurrent promises reading from the database, appending a branch, and writing back to the database.
- **Expected Behavior**: 101 branches in DB (seed branch `main` + 100 created branches).
- **Actual/Predicted Behavior**: 2 branches in DB.
- **Verdict**: **FAIL**
- **Analysis**:
  Because `testDbConcurrency` uses a separate `await readDb()` and `await writeDb(db)` call structure with a `setTimeout` delay in between, all 100 promises read the initial database (only containing `main`) before any of them write back their changes. Each promise then overwrites the database with its own branch appended to the initial database, leading to a classic "lost update" anomaly. Only the final write wins, leaving the database with only 2 branches.
- **Mitigation**: Developer code must not call `readDb()` and `writeDb()` separately for modification cycles. Instead, the transaction-safe `updateDb(updater)` function must be used, which executes read, update, and write under a single locked transaction queue.

### 2. CLI Concurrency (`testCliConcurrency`)
- **Scenario**: 10 concurrent processes executing the `branch` CLI command.
- **Expected Behavior**: 11 branches in DB (seed branch `main` + 10 created branches).
- **Actual/Predicted Behavior**: 11 branches in DB.
- **Verdict**: **PASS**
- **Analysis**:
  The `mock-memfork.js` CLI wraps operations in a `runTransactional` wrapper, which uses an atomic directory lock (`fs.mkdirSync(dbPath + '.lock')`). If the lock exists, concurrent processes perform backoff (20-50ms) and retry up to 10 seconds. This successfully serializes the processes and ensures all 11 branches are created without data loss.

---

## Argument Parsing Challenge Results

### 1. Hyphen Fact Handling (`testHyphenFact`)
- **Scenario**: Committing a fact prefixed with a hyphen (e.g., `"- Use PostgreSQL"`).
- **Expected Behavior**: Facts are committed and recalled correctly.
- **Actual/Predicted Behavior**: Committed facts: `['- Use PostgreSQL', 'Normal Fact']`. Recalled facts: `['- Use PostgreSQL', 'Normal Fact']`.
- **Verdict**: **PASS**
- **Analysis**:
  The flag scanner in `mock-memfork.js` iterates starting at index 4 of `process.argv` and only flags specific control options (`-m`, `--sleep`, `--facts`). A hyphenated string like `"- Use PostgreSQL"` is ignored by the control flag detector and is safely collected by the facts collector loop.
- **Critical Vulnerability**: If a fact is exactly `"--sleep"`, the CLI script's startup check `process.argv.includes('--sleep')` evaluates to `true`, causing the script to hang infinitely (`await new Promise(() => {})`). This constitutes a denial-of-service vulnerability via input fact names.

### 2. Branch Name Collision (`testBranchNameCollision`)
- **Scenario**: Creating and committing to a branch named `"-m"`.
- **Expected Behavior**: Branch `"-m"` is successfully created and committed to.
- **Actual/Predicted Behavior**: Committed message: `My real message`, Committed facts: `['Fact 1']`.
- **Verdict**: **PASS**
- **Analysis**:
  The branch name `"-m"` passes validation `/^[a-zA-Z0-9-_/]+$/`. During `commit`, the arguments are passed as `commit -m -m "My real message" --facts "Fact 1"`. The parser takes `args[1]` (which is `process.argv[3]`, the first `"-m"`) as the branch name, and searches for option flags starting at `process.argv[4]`, finding the second `"-m"` as the message flag.
- **Critical Vulnerability**: If a user runs `mock-memfork commit -m "message"` (forgetting the branch name), the parser interprets `"-m"` as the branch name, sees no message flag at or after index 4, and fails with `Commit message cannot be empty`. Branch names starting with hyphens should be disallowed to prevent option/parameter collisions.

---

## Challenges

### [High] Challenge 1: Non-atomic Database API Modification Pattern
- **Assumption challenged**: That locking `readDb()` and `writeDb()` individually is sufficient for concurrency safety.
- **Attack scenario**: Concurrent asynchronous operations in a Node.js process call `readDb()` to inspect the state, perform updates, and call `writeDb()` to save the changes.
- **Blast radius**: Severe database corruption, lost updates, and state divergence under async load.
- **Mitigation**: Deprecate separate public access to `writeDb` or mandate the use of `updateDb` for all modification cycles.

### [High] Challenge 2: CLI Parameter Injection Hang (`--sleep` Fact Denial of Service)
- **Assumption challenged**: That command-line arguments are sanitized and parsed unambiguously.
- **Attack scenario**: A user commits a fact whose content is exactly `"--sleep"`.
- **Blast radius**: The CLI process hangs infinitely, causing timeouts and blocking dependent automation tools.
- **Mitigation**: Avoid using naive `process.argv.includes('--sleep')` checks at the entry point. Use a robust parser (e.g., commander or minimist) or parse options explicitly relative to command contexts.

### [Medium] Challenge 3: Flag/Branch Name Collision
- **Assumption challenged**: That positional arguments and options do not collide.
- **Attack scenario**: Creating branches named after options (e.g. `"-m"`, `"--facts"`), or calling the CLI with omitted positional arguments.
- **Blast radius**: Command failure, unexpected state mutations, or user confusion.
- **Mitigation**: Disallow branch names from starting with a hyphen (`-`) in the `validateBranchName` logic.

---

## Unchallenged Areas

- **Merge proposals and conflict resolution** — Insufficient test coverage in the provided challenge scripts to stress-test concurrent merge proposals or resolution logic.
