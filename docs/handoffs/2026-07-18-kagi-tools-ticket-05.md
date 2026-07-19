# Handoff: kagi-tools implementation — mid ticket 05

Date: 2026-07-18

## Where things stand

Implementing the pi-kagi extension ticket-by-ticket (one commit per ticket). Tickets 01–04 are **done and committed**; ticket 05 is **in progress with uncommitted changes** in the working tree.

Commits (newest first):

- `eac2db6` — ticket 04: kagi_extract tool
- `e199bb6` — ticket 03: search cache + pagination
- `2880699` — ticket 02: kagi_search happy path
- `ee6cf26` — ticket 01: test runner + type-valid scaffold
- `5cd98b8` — spec + ticket files

Uncommitted work for ticket 05 (all tests green at 41/41, typecheck clean):

- `src/index.ts` — `promptSnippet` + cost-conscious `promptGuidelines` on both tools
- `test/extension.test.ts` — contract test for that metadata
- `package.json` — `peerDependenciesMeta` marking pi peers optional, pi packages pinned in `devDependencies`, keywords expanded
- `package-lock.json` — refreshed

The spec and ticket files live under `docs/planning/kagi-tools/` (spec.md + issues/01–05). Read those for the full design; don't duplicate their content here. Ticket 05's acceptance criteria are in `docs/planning/kagi-tools/issues/05-packaging-guidelines-release-prep.md`.

## What's left to do

1. **Rewrite the README** (ticket 05's biggest remaining item). Must cover: Kagi API billing prerequisite; `KAGI_API_KEY` env-var setup (deliberately no `.env` loading — pi resets managed clones on update, which would silently delete one; the repo's `.env.example` stays because the user may source it from their shell profile — do NOT touch the user's local `.env`, it holds their real key); both install routes (`pi install git:github.com/themauveavenger/pi-kagi` with optional `@vX.Y.Z` pin, and consumer `package.json` via `github:themauveavenger/pi-kagi#vX.Y.Z` **plus a pi settings entry pointing at that project's installed copy** — see spec for details); the tag-based release process (semver tags synced with `package.json` version, starting 1.0.0; pinned refs aren't moved by `pi update`).
2. **Re-verify the production install** after the package.json changes are committed. The earlier fresh-clone check ran against `git archive HEAD` (pre-package.json-changes), so it tested the OLD manifest. It proved the extension loads via a pi-style jiti alias with only the peers present, but the "optional peers → zero installed packages" behavior of the NEW manifest still needs a fresh check: `git archive HEAD | tar -x -C $TMP && cd $TMP && npm install --omit=dev` should yield no `node_modules` (or empty), then load `src/index.ts` via jiti with `typebox` aliased to pi's bundled copy and confirm both tools register. pi's own jiti + typebox live under pi's install dir (`dist/core/extensions/loader.js` `getAliases()` is the reference for the alias map).
3. **Tick ticket 05's checkboxes** (`docs/planning/kagi-tools/issues/05-packaging-guidelines-release-prep.md`) and commit as the fifth commit (conventional-commit format; `docs:`/`chore:` type as appropriate — it spans docs + packaging, pick the dominant one or split into two commits if that reads cleaner).
4. **Run `/code-review`** on the accumulated work — the `implement` skill requires it after the tickets are done. Review point: everything since `5cd98b8` (or `a33f30b` for the full branch).
5. **Hand back to the user** for the human steps: create the GitHub remote, push, tag `v1.0.0`, `pi install git:github.com/themauveavenger/pi-kagi` (they'll go unpinned globally, pinned in consumer projects), and disable `pi-web-access` themselves (already their plan — don't build anything for it).

## Facts already verified (don't re-litigate)

- pi's extension loader aliases `typebox`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, etc. to pi's bundled copies via jiti (`getAliases()` in `dist/core/extensions/loader.js` of the installed pi package) — optional peers are safe.
- `node --test` on Node 26 does not scan a bare directory arg; the glob form `node --test "test/**/*.test.ts"` works (already wired into `npm test`).
- Type stripping requires `import type` for type-only imports and forbids parameter properties/enums.
- The test seam is the tool `execute` boundary with an injected stub fetch (`test/helpers.ts`); cache behavior is asserted through the seam only.

## Repo gates (AGENTS.md)

Before ending any turn that wrote code: `npm test` fully green and `npm run typecheck` clean. Conventional commits. Issue tracker conventions in `docs/agents/`.

## Suggested skills

- `/skill:tdd` — for the remaining ticket-05 work (README is docs, but keep the test-first habit for any code touched)
- `/skill:code-review` — after ticket 05 commits, review the branch (spec at `docs/planning/kagi-tools/spec.md` is the spec axis)
- `/skill:conventional-commit` — commit messages
- `/skill:node` and `/skill:typescript-magician` — standing instruction from the user for all implementation work
- `/skill:octocat` — when the user is ready to create the GitHub remote and push
