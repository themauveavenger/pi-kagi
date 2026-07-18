# Spec: kagi_search & kagi_extract tools

Status: ready-for-agent

## Problem Statement

When working in pi, the agent has no access to Kagi, the user's preferred search engine. The user pays for metered Kagi API access and wants the agent to search the web and read pages through Kagi — with tight control over how much API spend and LLM context each interaction costs. The tools must be distributable as a pi extension installed directly from GitHub (no npm publishing), versioned with git tags, and consumable both as a global pi package and as a pinned dependency in other projects.

## Solution

A pi extension (zero runtime dependencies — native `fetch` and Node modules only) that registers two LLM-callable tools wrapping the two routes of the Kagi API (per the vendored spec at `docs/kagi_openapi.yaml`):

- **`kagi_search`** — web search with a deliberately minimal parameter surface (query plus pagination). Results return as compact markdown, and full result sets are cached in memory so paging and identical repeat searches cost nothing.
- **`kagi_extract`** — page-content extraction as markdown for a single URL, paged with `offset`/`limit` exactly like pi's built-in `read` tool, served from an in-memory cache so re-reading slices of a page is free.

The agent is steered toward economical behavior through prompt guidelines (search once, extract only what you intend to read) rather than through schema complexity — fewer choices for the agent, fewer paid calls for the user.

## User Stories

1. As an agent, I want to run a web search through Kagi with a single query string, so that I can find current information without choosing search modes.
2. As an agent, I want search results returned as a compact markdown list (numbered title-link, date, snippet), so that I can scan them cheaply.
3. As an agent, I want non-web result types (news, direct answers, infoboxes, related searches) rendered as labeled sections when present, so that useful answers aren't hidden.
4. As an agent, I want result metadata I can't act on (proxy image URLs, language probabilities, arbitrary props) stripped, so that my context stays lean.
5. As an agent, I want to control how many results I see with `limit`, so that I can trade breadth for context.
6. As an agent, I want to page deeper into the same query's results with `offset`, so that I can explore beyond the first page without a new paid API call.
7. As an agent, I want an identical repeat search served from cache with a visible `(from cache)` marker, so that the user isn't double-billed and I know the data may be stale.
8. As an agent, I want to extract the full markdown content of a single page by URL, so that I can read pages discovered via search.
9. As an agent, I want to page through extracted content with `offset`/`limit` in lines, mirroring pi's `read` tool, so that huge pages don't flood my context.
10. As an agent, I want a re-extract of the same URL served from cache, so that reading further slices of a page costs nothing.
11. As an agent, I want failed page extraction reported with its reason as normal content, so that I can fall back to the search snippet without the tool call being treated as an error.
12. As an agent, I want a hard byte cap on any tool response as a backstop, so that no single response can overflow my context window.
13. As an agent, I want a clear, actionable error when `KAGI_API_KEY` is unset, so that I can relay setup instructions to the user.
14. As an agent, I want HTTP failures mapped to plain-language messages (invalid key, forbidden IP, rate limited/quota exhausted, server error) including Kagi's trace ID, so that the user can debug or contact support.
15. As an agent, I want in-flight requests to respect cancellation, so that interrupting the session stops a slow search.
16. As the user, I want the agent guided via prompt guidelines to search once, extract only pages it intends to read, and avoid redundant calls, so that my metered Kagi bill stays small.
17. As the user, I want to provide my API key purely as an environment variable, so that no secret lives in files pi manages or wipes.
18. As the user, I want to install the extension with `pi install` straight from GitHub, optionally pinned to a tag, so that npm publishing isn't needed.
19. As the user, I want to pin the extension in another project's package.json via GitHub URL + tag and have pi load it from that project's node_modules, so that the project's tooling is reproducible.
20. As the user, I want the extension to carry zero runtime dependencies (native fetch/Node modules only), so that installs are fast and the supply chain stays minimal.
21. As the user, I want releases tagged semver (starting at 1.0.0) with package.json version kept in sync, so that pins are meaningful.
22. As the repo owner, I want typecheck clean and a real test suite wired into `npm test`, so that the repo's AGENTS.md gate holds for future changes.

## Implementation Decisions

### Modules

Four small modules, each hiding one concern:

- **Client module** — owns the HTTP boundary: auth header, JSON POSTs to the Kagi base URL, client-side timeouts, error-envelope parsing. Exposes a factory that accepts an injected `fetch` implementation and an API-key resolver, returning typed `search` and `extract` functions.
- **Cache module** — a small bounded FIFO map. Two instances: one for search result sets (keyed by query string), one for extracted pages (keyed by URL).
- **Format module** — turns raw API responses into the compact markdown the LLM sees, applying offset/limit slicing and truncation backstops.
- **Extension entry module** — registers the two tools with pi, wires client + caches + formatting together, and exports a tool factory so tests can construct tools with a stub fetch and fresh caches.

### Tool contracts (the agent-facing API)

`kagi_search` parameters:

| Param | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `query` | string, required | — | Sent as-is |
| `limit` | integer 1–25 | 10 | Applied client-side over cached results |
| `offset` | integer ≥ 1 | 1 | 1-based result index, mirroring pi's `read` tool |

`kagi_extract` parameters:

| Param | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `url` | string, required | — | Single HTTPS URL |
| `limit` | integer 1–2000 | 250 | Lines of extracted markdown |
| `offset` | integer ≥ 1 | 1 | 1-based line number, mirroring pi's `read` tool |

Everything else the Kagi routes accept is deliberately not exposed and hardcoded: `workflow: "search"` and `format: "json"` on both routes; no lenses, filters, personalizations, `safe_search` override, `page`, `timeout`, or the in-search `extract` option.

Key structural decisions:

- **`limit` is never sent to the Search API.** The spec states `limit` doesn't change the amount requested upstream, only what's returned. The full single-pass result set is cached keyed by `query` alone, and `limit`/`offset` slice client-side — so paging a query and repeating it are both free.
- **`kagi_extract` takes a single URL, not the API's 1–10 batch.** pi runs tool calls in parallel, so batching buys no speed in the agent loop; billing is per page either way; and a single document per call makes `offset`/`limit` map exactly onto `read`-tool semantics, which is gentler on agent reasoning.
- **Errors throw; per-page extraction failure does not.** Whole-call HTTP failures (400/401/403/429/500, network errors) throw an `Error` with a status-aware plain-language message including Kagi's error code and `meta.trace` ID — throwing is how pi marks a tool result as an error. A page that fails extraction within a successful call returns its failure reason as ordinary content instead.
- **API key resolution happens at execute time**, reading `KAGI_API_KEY` from the environment; a missing key throws with setup instructions. No `.env` file is read or shipped (pi resets/cleans managed clones on update, which would silently delete one).
- **Cancellation and timeouts** combine the tool's `AbortSignal` with a client-side timeout via `AbortSignal.any()` — 15s for search, 30s for extract.

### Caching

- In-memory, module-scope, process lifetime; shared across sessions; no TTL.
- FIFO eviction at caps: 50 search queries, 100 extracted pages — a long-lived pi process can't grow memory unboundedly.
- Cache hits are marked `(from cache)` in the tool output so both user and agent know no paid call occurred and the data may be stale.

### Output shaping

- Search renders as a numbered markdown list (`[title](url) — date` + snippet capped ~240 chars); non-web arrays present in the response (news, direct answers, infoboxes, related searches, etc.) render as their own labeled sections; `props` and proxy image URLs are stripped.
- Extract renders a header with the URL and the page's total line count, then the requested line slice; when more content remains, a trailing note tells the agent the next `offset` to use.
- A 50KB byte cap backstops every tool response regardless of line limits.

### Prompt metadata

- Both tools get a one-line `promptSnippet` and `promptGuidelines` that name the tools explicitly (pi appends guidelines flat, with no tool-name prefix).
- Guidelines encode cost discipline: prefer `kagi_search` first; call `kagi_extract` only on URLs you intend to read; page via `offset`/`limit` rather than repeating calls; don't re-issue identical searches (the cache makes repeats free, but avoid them anyway).

### Packaging, versioning, distribution

- Zero runtime dependencies. `@earendil-works/pi-coding-agent` and `typebox` stay `peerDependencies` (`*`) and are additionally marked optional via `peerDependenciesMeta` and added to `devDependencies`, so consumers installing via npm-from-GitHub don't drag in a duplicate pi while local typechecking still works.
- No build step — pi loads TypeScript via jiti.
- Versioning: semver git tags `vX.Y.Z` kept in sync with `package.json` `version`, starting at `1.0.0`.
- Global install: `pi install git:github.com/themauveavenger/pi-kagi` (unpinned; docs don't specify unpinned update behavior — verify empirically at install time).
- Consumer project: `github:themauveavenger/pi-kagi#vX.Y.Z` in that project's package.json, plus a pi settings entry pointing at the installed package under that project's node_modules. Pinned refs are not moved by `pi update`; upgrading means re-running `pi install` with the new tag (or bumping the tag in package.json).
- README documents: Kagi API billing prerequisite, environment-variable setup, both install routes, and the release process.

## Testing Decisions

- **One seam: the tool execution boundary with `fetch` injected.** Tool definitions are plain objects; tests build them via the exported factory with a stub `fetch` and a fixed key, call `execute`, and assert on (a) the outgoing request — URL, method, `Authorization` header, JSON body — and (b) the returned content string or thrown error. No booting pi, no network, no mocking library. This is the highest practical seam and covers client, cache, and format modules together.
- **Good tests assert external behavior only.** Cache behavior is verified through the seam (a second identical call performs no second fetch and includes the `(from cache)` marker), never by inspecting map internals or testing private helpers.
- **Coverage targets:** request construction and parameter→body mapping; hardcoded fields never leaking agent input into them; result formatting (list shape, labeled sections, snippet cap, stripped noise); pagination math including out-of-range offsets; cache hit/eviction behavior through the seam; error mapping for each HTTP status plus malformed error envelopes and network failure; missing API key; per-page extraction failure returned as content; the 50KB backstop (driven with programmatically generated payloads); cancellation signal reaching fetch.
- **Runner:** Node's built-in `node --test` with `node:assert/strict`, using native TypeScript type stripping (Node 26) — no new dependencies. The placeholder `test` script is replaced.
- **Prior art:** none — this is a greenfield repo; this suite establishes the testing pattern.

## Out of Scope

- The Search API's `workflow` enum (image/video/news/podcast-specific search), lenses and lens IDs, filters (region/date), personalizations, `safe_search` configuration, `page`, and the experimental `format: "markdown"` response option.
- The Search API's in-search `extract` option (billed extra; the two-step search-then-extract flow is cheaper and context-friendlier).
- Multi-URL batch extraction (single-URL by design — see Implementation Decisions).
- Custom TUI rendering (`renderCall`/`renderResult`) — pi's default tool rendering with a label is sufficient for v1.
- Publishing to npm.
- Persistent or TTL-based caching, session-scoped cache clearing.
- Using Kagi's official TypeScript client library (native fetch per project constraint).

## Further Notes

- Kagi API access requires billing to be set up on the Kagi API dashboard, separate from a consumer Kagi subscription; calls are metered. This is the primary motivation for the cache and the cost-conscious prompt guidelines.
- The user will disable the `pi-web-access` package in their own setup to avoid overlapping web tools; the extension does not need to disambiguate against other search tools.
- If an enum parameter is ever added to either tool, it must use `StringEnum` from `@earendil-works/pi-ai` (Google's function-calling API rejects the union-of-literals schema shape), which would add `pi-ai` as an optional peer dependency.
- The vendored `docs/kagi_openapi.yaml` (downloaded 2026-05-19) is the source of truth for request/response shapes.

## Comments
