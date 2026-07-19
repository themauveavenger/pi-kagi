# 02 — `kagi_extract` refresh parameter

**Parent:** docs/planning/kagi-tools/issues/04-kagi-extract.md

**What to build:** `kagi_extract` gains an optional `refresh: boolean` (default false). When `true`, the cache is bypassed for that call and the freshly fetched page replaces whatever was cached; subsequent calls with `refresh=false` (or unset) read from the cache as normal. Pairs naturally with #01 — a transient extract failure can be retried without restarting the agent process. Sequenced after #01 by maintainer priority, but technically independent.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Schema gains `refresh: Type.Optional(Type.Boolean({ default: false }))` with a description that says "Bypass the cache for this call and overwrite the cached page with the fresh result"
- [ ] When `refresh=true`, the page is fetched even if the URL is already cached
- [ ] The fresh result is written back to the cache so a subsequent call with `refresh=false` (or unset) is served from cache and shows the `(from cache)` marker
- [ ] When `refresh=false` (default), behaviour is unchanged
- [ ] The `(from cache)` marker is accurate for all four combinations of `refresh` value and prior cache state
- [ ] The new parameter and behaviour are covered by tests through the tool seam
- [ ] `npm run typecheck` and `npm test` pass

## Comments
