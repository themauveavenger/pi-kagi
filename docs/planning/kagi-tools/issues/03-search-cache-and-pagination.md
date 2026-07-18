# 03 — Search cache + client-side pagination

**Parent:** docs/planning/kagi-tools/spec.md

**What to build:** `kagi_search` gains `limit` and `offset` pagination, backed by an in-memory cache that makes repeat and paged searches free. The full single-pass result set is cached keyed by query string (per the Kagi spec, `limit` doesn't change what's fetched upstream — so it's never sent), and `limit`/`offset` slice the cached set client-side. An agent can ask for "more results" on a query it already ran without costing the user another paid call, and can see when results came from cache.

**Blocked by:** 02 — kagi_search happy path

**Status:** ready-for-agent

- [x] `kagi_search` accepts `limit` (integer 1–25, default 10) and `offset` (integer ≥ 1, default 1), interpreted as a 1-based result index mirroring pi's `read` tool
- [x] `limit` and `offset` never appear in the API request body
- [x] A search identical to a previous one performs no fetch and its output includes a `(from cache)` marker
- [x] Paging the same query with different `offset`/`limit` values performs no new fetch
- [x] An `offset` beyond the available results returns a clear message stating how many results the query has, rather than an error
- [x] The search cache is module-scope, process-lifetime, shared across sessions, with FIFO eviction beyond 50 entries
- [x] Cache behavior is verified through the tool seam only (second call performs no second fetch, marker present) — no inspecting cache internals in tests
- [x] `npm run typecheck` and `npm test` pass

## Comments
