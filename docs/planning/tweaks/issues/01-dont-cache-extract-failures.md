# 01 — Don't cache extraction failures

**Parent:** docs/planning/kagi-tools/issues/04-kagi-extract.md

**What to build:** When the Kagi extract API returns a successful HTTP response that contains a per-page `error`, the page is not stored in the cache. A later call for the same URL re-attempts the extract instead of returning the cached failure for the lifetime of the process. Extraction still surfaces as ordinary readable content for the original call — only the cache behaviour changes.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] A page whose `data` entry has `error` set is not written to the page cache
- [x] A second call for the same URL after a failed extract triggers a new fetch (verifiable through the tool seam by the underlying call counter incrementing)
- [x] A successful extract following a failed one writes the success to the cache and a third call for the same URL serves it as cached, with the `(from cache)` marker present
- [x] The existing per-page extraction failure still surfaces as ordinary readable content, not as a thrown error
- [x] The existing test asserting that a cached failure is not retried is updated to assert the new contract (a cached failure IS retried on the next call)
- [x] `npm run typecheck` and `npm test` pass

## Comments
