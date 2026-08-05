# pi-kagi

A pi extension that gives the agent two metered, Kagi-backed capabilities — web search and page extraction — with caching and cost-conscious prompt guidance to keep the user's Kagi bill small.

## Language

**Kagi**:
The metered web-search and page-extraction API the extension wraps. Calls cost the user money; this billing model is the motivation for caching and the cost-conscious prompt guidelines.
_Avoid_: the API, the service

**kagi_search**:
The agent-facing capability that runs a Kagi web search from a single query string and returns a compact markdown list of results.
_Avoid_: search tool, the search API, search endpoint

**kagi_extract**:
The agent-facing capability that fetches a single web page's content as markdown by URL, paged like pi's built-in `read` tool.
_Avoid_: extract tool, the extract API, fetch page

**Result set**:
The full set of Kagi search results returned for one query in a single pass — web results plus any non-web result types. Paging a query reuses its result set rather than re-requesting.
_Avoid_: search response, search payload, results (ambiguous — say web results or non-web result types)

**Web results**:
The primary search results — the numbered list of title-link entries Kagi returns in the `search` array, rendered first.
_Avoid_: search results, main results, regular results

**Non-web result types**:
Kagi result arrays other than web results (news, direct answers, infoboxes, related searches), rendered as labeled sections after the web results.
_Avoid_: extra sections, secondary results, other results

**Page**:
The extracted markdown content of a single URL, plus its total line count. One URL per `kagi_extract` call by design — never the API's 1–10 batch.
_Avoid_: extracted document, article, page response

**Paid call**:
A Kagi API invocation the user is billed for. Cache hits are not paid calls; cache misses are. The central cost unit the tools are designed around.
_Avoid_: API call, request, fetch

**Search budget**:
The maximum number of paid `kagi_search` calls permitted during one agent run. Cache hits do not consume it; each new agent run receives a fresh budget. Carries a lifecycle state — `idle` (no run yet), `active` (run in progress), `settled` (run finished, count retained) — which the footer wording follows.
_Avoid_: search allowance, search limit

**Agent run**:
Pi's active work period, from `agent_start` until `agent_settled`. Ends when control returns to the human, which is why the search budget is scoped to it rather than to a single model turn. A settled run retains its search-budget count for status display.
_Avoid_: task, turn

**Cache marker**:
The `(from cache)` suffix in tool output that tells both user and agent a result came from the cache — no paid call occurred, and the data may be stale.
_Avoid_: from-cache tag, cache flag

**Shared cache**:
The search and page caches held in module scope so they outlive a session switch. pi re-invokes the extension factory per session but does not re-import the module, so module scope is what survives `/new` and `/resume`; `/reload` and a cwd change clear it.
_Avoid_: global cache, persistent cache (nothing is written to disk)

**Trace**:
Kagi's request identifier returned in error responses, surfaced to the user for debugging or support contact.
_Avoid_: trace id, request id, correlation id

**Per-page failure**:
A failed extraction of a single page within an otherwise-successful `kagi_extract` call. Reported as ordinary content with its reason, not thrown — so the agent can fall back to a search snippet. Contrast whole-call failure.
_Avoid_: page error, extraction error

**Whole-call failure**:
An HTTP or network failure of an entire `kagi_search` or `kagi_extract` call (bad request, bad key, forbidden IP, rate-limited, server error, network drop). Thrown as an error with a plain-language message and Kagi's trace, so pi marks the tool result as failed. Contrast per-page failure.
_Avoid_: API error, request failure, call error