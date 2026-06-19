# Forensic Audit Plan

This plan details the step-by-step independent verification of the memfork workspace.

## Steps

1. **Verify Workspace Layout Compliance**:
   - Check that all source files and tests are located in designated directories conforming to `PROJECT.md` and `ORIGINAL_REQUEST.md` (no source/test files in `.agents/`).
   
2. **Static Code Inspection for Hardcoded Test Results & Facades**:
   - Inspect `scripts/mock-memfork.js` to verify it implements general CLI logic rather than bypass rules.
   - Inspect `lib/db/db.ts` to verify it operates on file input/output and schema validation properly.
   - Inspect `lib/memory/merge.ts` to verify the conflict detection algorithm is general and not hardcoded to specific test strings.
   - Inspect `lib/agents/orchestrator.ts` to evaluate the mock generator design and confirm there are no hardcoded bypass conditions.

3. **Verify E2E Tests Assertions**:
   - Inspect `tests/e2e/*.test.js` to ensure the assertions are authentic, testing real side effects, rather than self-certifying or fake.

4. **Verify Dependency Usage**:
   - Analyze `package.json` to ensure no prohibited external dependencies are used for core features (Benchmark Mode check).

5. **Behavioral Analysis (Dry-Run / Code Trace)**:
   - Trace flow for database locking, conflict resolution, and parallel pipelines to verify completeness.
