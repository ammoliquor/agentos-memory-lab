# Scope: M1 - Core DB & CLI Wrapper

## Architecture
- CLI wrapper: `lib/memory/memfork.ts`
- DB helper: `lib/db/db.ts`
- Database file: `.memfork/db.json`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | DB Schema & Helpers | Setup db.json structures and basic CRUD helpers | None | DONE |
| 2 | Memfork CLI Wrapper | Integrate child_process execution for branch, recall, commit | 1 | DONE |
| 3 | Core Integration Tests | Unit/integration tests verifying the DB and CLI wrapper | 1, 2 | DONE |
