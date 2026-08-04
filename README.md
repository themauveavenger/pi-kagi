# pi-kagi

A [pi](https://pi.dev) extension that gives the agent two metered, cost-conscious tools backed by the [Kagi API](https://kagi.com/api): **`kagi_search`** and the page extractor **`kagi_extract`**.

The agent is steered toward cheap behavior through tool prompt guidelines — search first, extract only pages you intend to read, page with `offset`/`limit` rather than re-issuing calls — and through two in-memory caches (search result sets keyed by query, extracted pages keyed by URL) that make paging and repeat lookups free. It also enforces a maximum of two uncached searches per agent run, while leaving extraction unrestricted. The extension has **zero runtime dependencies**: it uses native `fetch` and Node modules only, and the pi-provided peer packages (`@earendil-works/pi-coding-agent`, `typebox`) are resolved at runtime to pi's own bundled copies via the extension loader's jiti alias map, so installing this package never drags in a duplicate copy of pi.

## Prerequisites

- **A Kagi API key with billing set up.** Kagi API access is metered and is billed separately from a consumer Kagi subscription. Enable API access and add billing on the [Kagi API dashboard](https://kagi.com/api). Every uncached `kagi_search` and `kagi_extract` call costs a small amount against that balance — which is exactly why this extension caches aggressively and nudges the agent to be sparing.
- **pi** (the `pi` CLI) installed and on your `PATH`.
- **Node.js 26+** (the extension and its tests use native TypeScript type stripping; pi loads the `.ts` source directly via jiti, so there is no build step).

## Set your API key

`pi-kagi` reads its key from the `KAGI_API_KEY` environment variable at tool-call time. Set it in your shell profile so every pi session inherits it:

```sh
# ~/.zshrc, ~/.bashrc, etc.
export KAGI_API_KEY="your_kagi_api_key"
```

> **No `.env` file is read or shipped.** pi resets and cleans its managed package clones on update, which would silently delete a `.env` managed alongside the extension. A `.env.example` is committed to this repo only as documentation of the variable name — it is never loaded by the extension. Keep your real key in your shell environment.
>
> (`.env` is gitignored, so if you keep one for other tooling it won't be committed. Just don't rely on the extension to load it.)

## Install

This extension is distributed from GitHub only — it is **not** published to npm. There are two install routes.

### 1. Global install with `pi install` (recommended for personal use)

```bash
pi install git:github.com/themauveavenger/pi-kagi
```

This clones the repo into pi's managed package directory and writes it to your user settings (`~/.pi/agent/settings.json`). Unpinned installs are updated by `pi update --extensions` (or `pi update --all`).

To **pin to a release tag**, append `@vX.Y.Z`:

```bash
pi install git:github.com/themauveavenger/pi-kagi@v1.0.0
```

Pinned refs are **not** moved by `pi update --extensions` / `pi update --all` — those commands only reconcile an existing clone back to its configured ref. To upgrade a pinned install, re-run `pi install git:github.com/themauveavenger/pi-kagi@vX.Y.Z` with the new tag (or drop the `@…` pin to track the default branch).

To remove it:

```bash
pi remove git:github.com/themauveavenger/pi-kagi
```

### 2. Pinned dependency in another project's `package.json` (recommended for shared/reproducible setups)

For a project that needs a reproducible, version-controlled extension, add `pi-kagi` as a git dependency and let pi load it from that project's `node_modules`:

```jsonc
// package.json in the consuming project
{
  "dependencies": {
    "pi-kagi": "github:themauveavenger/pi-kagi#v1.0.0"
  }
}
```

```bash
npm install
```

Then register that installed copy with pi as a **local-path** package in the project's pi settings (`.pi/settings.json`):

```jsonc
// .pi/settings.json in the consuming project
{
  "packages": [
    "./node_modules/pi-kagi"
  ]
}
```

Or, equivalently, let `pi install` write that entry for you:

```bash
pi install -l ./node_modules/pi-kagi
```

Why this is lean: `npm install` of a git dependency installs the package's `dependencies` only. `pi-kagi` declares its pi-provided peers (`@earendil-works/pi-coding-agent`, `typebox`) as **optional** peer dependencies (`peerDependenciesMeta`) and pins them only in `devDependencies` (for this repo's own typechecking) — so a consumer's `npm install` pulls in **no** extra packages: no duplicate copy of pi, no `typebox`. At runtime pi's extension loader aliases `typebox` and `@earendil-works/pi-coding-agent` to its own bundled copies, so the extension loads with zero installed dependencies.

To upgrade, bump the tag in `package.json` (`github:themauveavenger/pi-kagi#vX.Y.Y`) and re-run `npm install`. Pinned git refs are not moved by `pi update`.

## Tools

### `kagi_search`

Search the web with Kagi. Returns a compact markdown list of results.

| Parameter | Type | Default | Notes |
| --------- | ---- | ------- | ----- |
| `query` | string, required | — | Sent as-is. |
| `limit` | integer 1–25 | 10 | Client-side slice; **not** sent to the API. |
| `offset` | integer ≥ 1 | 1 | 1-based index to page into the cached result set; no new paid call. |

The full single-pass result set for a query is cached in memory (process lifetime, FIFO eviction at 50 queries), so paging with `offset`/`limit` and repeating identical queries both cost nothing. Cache hits are marked `(from cache)`. Non-web result types present in the response (news, direct answers, infoboxes, related searches) are rendered as labeled sections; machine-only noise (`props`, proxy image URLs, language probabilities) is stripped.

### Search budget and status

`kagi_search` permits at most two uncached searches while pi works on one prompt. The allowance resets only after pi settles and control returns to you. Cached repeats and pagination are free and do not count; `kagi_extract` is not capped.

The footer shows the active search allowance plus paid-search, paid-extract, and cache-hit totals. Hide or restore it for the current session with `/kagi status off` or `/kagi status on`.

### `kagi_extract`

Extract a single web page's content as markdown. Long pages are paged with `offset`/`limit` in lines, mirroring pi's built-in `read` tool.

| Parameter | Type | Default | Notes |
| --------- | ---- | ------- | ----- |
| `url` | string, required | — | A single HTTPS URL. |
| `limit` | integer 1–2000 | 250 | Lines of extracted markdown to return. |
| `offset` | integer ≥ 1 | 1 | 1-based line number to start from. |

Extracted pages are cached by URL (process lifetime, FIFO eviction at 100 pages), so reading further slices of the same page is free. A page that fails extraction inside an otherwise-successful call returns its failure reason as ordinary content (not a tool error) so the agent can fall back to the search snippet. Whole-call HTTP failures throw with a plain-language message including Kagi's error code and `meta.trace` ID. Every tool response is backstopped by a 50 KB byte cap regardless of line limits.

## Releases

Releases are git tags, kept in sync with the `version` field in [`package.json`](./package.json) (semver, starting at `1.0.0`).

To cut a release:

1. If the version is changing, update `version` in `package.json` and commit.
2. Tag the commit: `git tag vX.Y.Z`.
3. Push the tag: `git push origin vX.Y.Z`.

Consumers pin to these tags (see the install routes above). There is no npm publish step.

## Development

```bash
npm install        # installs pi + typebox as dev deps for typechecking
npm run typecheck  # tsc --noEmit
npm test           # node --test "test/**/*.test.ts" (Node 26 native TS type stripping)
```

The test suite uses a single seam — the tool `execute` boundary with an injected stub `fetch` (`test/helpers.ts`) — so it exercises the client, cache, and format modules together with no network and no mocking library. See [`docs/planning/kagi-tools/spec.md`](./docs/planning/kagi-tools/spec.md) for the design and the ticket history under `docs/planning/kagi-tools/issues/`.

License: MIT.