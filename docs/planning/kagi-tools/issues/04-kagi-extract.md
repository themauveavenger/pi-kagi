# 04 — kagi_extract end-to-end

**Parent:** docs/planning/kagi-tools/spec.md

**What to build:** An agent can pass a single URL to `kagi_extract` and read the page's content as markdown, paged with `offset`/`limit` in lines exactly like pi's `read` tool — so a huge page never floods the context, and reading further slices costs nothing because extracted pages are cached by URL. Extraction failures for individual pages come back as ordinary content the agent can reason about, not as tool errors.

**Blocked by:** 03 — Search cache + client-side pagination

**Status:** ready-for-agent

- [x] `kagi_extract` accepts a single `url` (required) plus `limit` (integer 1–2000, default 250) and `offset` (integer ≥ 1, default 1), interpreted as 1-based lines of the extracted markdown, mirroring pi's `read` tool
- [x] Output begins with a header containing the URL and the page's total line count, then the requested slice; when more content remains, a trailing note states the next `offset` to use
- [x] Extracted pages are cached keyed by URL; a repeat extract of the same URL (any `offset`/`limit`) performs no second fetch and shows a `(from cache)` marker
- [x] The page cache is module-scope, process-lifetime, with FIFO eviction beyond 100 entries
- [x] A page whose extraction fails within a successful API call returns the failure reason as ordinary content — the tool result is NOT marked as an error
- [x] Every tool response is hard-capped at 50KB as a backstop, via the shared formatter (applies to both tools)
- [x] The client supports the extract route with a 30s client-side timeout, combined with the tool's `AbortSignal`
- [x] Tests through the tool seam cover slicing math, out-of-range offsets, cache hits, per-page extraction failure, and the byte cap (using programmatically generated payloads)
- [x] `npm run typecheck` and `npm test` pass

## Comments
