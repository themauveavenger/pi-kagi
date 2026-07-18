# 05 — Packaging, prompt guidelines, README, release prep

**Parent:** docs/planning/kagi-tools/spec.md

**What to build:** The extension becomes installable, steerable, and documented. The agent sees cost-conscious usage guidelines in pi's system prompt; consumers installing from GitHub (via `pi install` or a package.json git dependency) get a lean install without a duplicate copy of pi; and the README documents everything needed to set up, install, consume, and release the extension — ending in a state ready to push and tag `v1.0.0`.

**Blocked by:** 04 — kagi_extract end-to-end

**Status:** ready-for-agent

- [ ] Both tools declare a one-line `promptSnippet` and `promptGuidelines` that name the tools explicitly (pi appends guidelines flat, with no tool-name prefix) and encode cost discipline: search first, extract only pages you intend to read, page via `offset`/`limit` instead of repeating calls, avoid identical repeat searches
- [ ] `peerDependenciesMeta` marks the pi-provided peer dependencies (`@earendil-works/pi-coding-agent`, `typebox`) optional, and both also appear in `devDependencies` — consumers installing via npm-from-GitHub don't drag in a duplicate pi, while local typechecking keeps working
- [ ] The extension loads when installed from a fresh clone with production-only dependencies (no devDependencies present)
- [ ] README documents: the Kagi API billing prerequisite; `KAGI_API_KEY` environment-variable setup (no `.env` file — pi resets managed clones on update); both install routes (`pi install git:…` with optional tag pin, and package.json `github:…#vX.Y.Z` plus a pi settings entry pointing at the project's installed copy); and the tag-based release process (semver tags kept in sync with `package.json` `version`, starting at `1.0.0`; pinned refs are not moved by `pi update`)
- [ ] `package.json` version is `1.0.0` and metadata (description, keywords, license, author) is accurate
- [ ] `npm run typecheck` and `npm test` pass; repo is ready to push to the new GitHub remote and tag `v1.0.0`

## Comments
