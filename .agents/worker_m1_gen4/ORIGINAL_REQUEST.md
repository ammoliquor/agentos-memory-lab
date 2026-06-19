## 2026-06-19T02:40:27Z

You are the Worker for Milestone 1 Gen 4.
Your working directory is C:\Users\USER\antigravitycliproject\memfork\.agents\worker_m1_gen4.
Your task is to refactor `recallFacts` in `lib/memory/merge.ts` to resolve the conflict resolution fact tombstoning edge case.

Currently, `recallFacts` builds a global `retractedSet` of all retracted facts from all ancestor commits and filters out any fact whose normalized form is in that set. This is incorrect because if a fact is retracted in a merge commit but also asserted as a resolved fact in that same merge commit, the resolved fact gets filtered out and is not recalled.

To fix this:
Refactor `recallFacts` in `lib/memory/merge.ts` to:
1. Initialize a Set for active normalized facts and a Map for mapping normalized facts to their original-cased strings.
2. Sort the ancestor commits by timestamp (oldest first).
3. Loop through the sorted ancestor commits:
   a. If the commit has retractions (commit.retractions), delete their normalized forms from the active facts Set.
   b. Loop through the commit's facts (commit.facts), add their normalized forms to the active facts Set, and save the original-cased fact in the Map.
4. After the loop, map the active normalized facts back to their original-cased strings and return them.

After making the change, execute `node scripts/verify-project.js` to ensure the TypeScript typecheck and E2E test suite passes cleanly.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
