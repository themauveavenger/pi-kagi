# 02 — kagi_search happy path

**Parent:** docs/planning/kagi-tools/spec.md

**What to build:** An agent can call `kagi_search` with a query string and receive a compact markdown result list — numbered title-link entries with dates and capped snippets, labeled sections for non-web result types, and all machine-only noise stripped. Behind the tool stands the full vertical: a client module wrapping the Kagi Search route (auth resolved at execute time, cancellation plus client-side timeout, status-aware errors carrying Kagi's trace ID), a format module shaping responses for LLM consumption, and a tool factory exported so tests can inject a stub fetch. Caching and pagination are explicitly NOT in this ticket.

**Blocked by:** 01 — Repo foundation: green gates + test runner

**Status:** ready-for-agent

- [x] Calling `kagi_search` with a query POSTs JSON to the Kagi search endpoint with a Bearer `Authorization` header; the body contains the query and the hardcoded `workflow: "search"` / `format: "json"` only
- [x] Results render as a numbered markdown list: `[title](url)`, date when present, snippet capped at ~240 characters
- [x] Non-web result arrays present in the response (news, direct answers, infoboxes, related searches, etc.) render as their own labeled sections
- [x] `props` and Kagi proxy image URLs never appear in tool output
- [x] HTTP 400/401/403/429/500 and network failures throw errors with plain-language, status-aware messages including Kagi's error code and `meta.trace` ID when available
- [x] An unset `KAGI_API_KEY` throws an error containing setup instructions before any request is made
- [x] The tool's `AbortSignal` reaches fetch (interrupting the session cancels an in-flight search), combined with a 15s client-side timeout
- [x] All behavior above is covered by tests through the tool `execute` boundary with an injected stub fetch — no network, no mocking library
- [x] `npm run typecheck` and `npm test` pass

## Comments
