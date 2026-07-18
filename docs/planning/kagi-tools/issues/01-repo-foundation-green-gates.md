# 01 — Repo foundation: green gates + test runner

**Parent:** docs/planning/kagi-tools/spec.md

**What to build:** The repo's quality gates pass on the scaffold, establishing the foundation every later ticket relies on: `npm run typecheck` exits clean, and `npm test` runs a real test suite using Node's built-in test runner with native TypeScript type stripping — no new dependencies. This establishes the dependency-free testing pattern the feature tickets will use.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] `npm run typecheck` exits 0 with no errors (the scaffold's stub tool definitions made type-valid)
- [x] `npm test` runs Node's built-in test runner against TypeScript test files, with no mocking or test-framework dependencies added
- [x] At least one meaningful test exists and passes
- [x] No new runtime or dev dependencies are introduced

## Comments
