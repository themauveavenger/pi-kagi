import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBoundedCache, type BoundedCache } from "./cache.ts";
import { createKagiClient, type PageOutput, type SearchResponse } from "./client.ts";
import { createExtractTool, PAGE_CACHE_MAX_ENTRIES } from "./extract-tool.ts";
import { createSearchTool, SEARCH_CACHE_MAX_ENTRIES } from "./search-tool.ts";
import { readKagiSource } from "./tool-details.ts";
import SearchBudget from "./search-budget.ts";

// Whole-call failures are part of this package's interface: callers that
// branch on a bad key versus a rate limit need the classes, not the prose.
export { KagiApiError, KagiRequestError, KagiTimeoutError, MissingApiKeyError } from "./errors.ts";

export interface KagiToolsOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
  extractTimeoutMs?: number;
}

/**
 * Module-scope caches, deliberately outside the extension factory.
 *
 * pi caches the extension factory function and re-invokes it for every new,
 * resumed, or forked session (dist/core/extensions/loader.js:318-373), so
 * anything closed over inside the default export is rebuilt per session
 * while module scope survives. Keeping the caches here is what makes a page
 * fetched before `/new` still free after it. They are dropped only by
 * `/reload` (which clears pi's extension cache and re-evaluates this module)
 * or by switching cwd — both correct: the first means "pick up my code
 * changes", the second must not leak results across projects.
 *
 * No TTL: entries live until FIFO eviction. Per-run and per-session state
 * (the search budget, the footer counters) stays inside the factory.
 */
const sharedSearchCache = createBoundedCache<string, SearchResponse>(SEARCH_CACHE_MAX_ENTRIES);
const sharedPageCache = createBoundedCache<string, PageOutput>(PAGE_CACHE_MAX_ENTRIES);

/**
 * Empties the shared caches. Because they outlive the extension factory,
 * tests that load the extension more than once would otherwise leak
 * results between cases — a repeated query would silently become a cache
 * hit. Call this between such cases. Not used in production: at runtime the
 * whole point is that the caches persist across sessions.
 */
export function resetSharedCaches(): void {
  sharedSearchCache.clear();
  sharedPageCache.clear();
}

export function createKagiTools(
  options: KagiToolsOptions,
  dependencies: {
    searchBudget?: SearchBudget;
    searchCache?: BoundedCache<string, SearchResponse>;
    pageCache?: BoundedCache<string, PageOutput>;
  } = {},
): [ReturnType<typeof createSearchTool>, ReturnType<typeof createExtractTool>] {
  const client = createKagiClient(options);
  // Fresh per call unless a cache is injected, so each caller (and each
  // test) is isolated by default and sharing is an explicit decision.
  const searchCache = dependencies.searchCache ?? createBoundedCache<string, SearchResponse>(SEARCH_CACHE_MAX_ENTRIES);
  const pageCache = dependencies.pageCache ?? createBoundedCache<string, PageOutput>(PAGE_CACHE_MAX_ENTRIES);

  return [createSearchTool(client, searchCache, dependencies.searchBudget), createExtractTool(client, pageCache)];
}

export default function (pi: ExtensionAPI) {
  const searchBudget = new SearchBudget(2);
  let showStatus = true;
  let paidSearches = 0;
  let paidExtracts = 0;
  let cacheHits = 0;

  /**
   * The search segment of the footer, phrased for the budget's lifecycle
   * state so an idle count is never mistaken for a live cap and an
   * exhausted run says plainly that the next run starts over.
   */
  function formatSearchStatus(): string {
    const used = searchBudget.getUsed();
    const limit = searchBudget.getLimit();
    switch (searchBudget.getState()) {
      case "idle":
        return `search ${used}/${limit} per run`;
      case "active":
        return used >= limit ? `search ${used}/${limit} this run (limit reached)` : `search ${used}/${limit} this run`;
      case "settled":
        return used > 0 ? `search ${used}/${limit} last run · resets next run` : `search ${used}/${limit} last run`;
    }
  }

  function updateStatus(ctx: { ui: { setStatus(key: string, value: string | undefined): void } }): void {
    ctx.ui.setStatus(
      "kagi",
      showStatus
        ? `Kagi: ${formatSearchStatus()} · paid S:${paidSearches} E:${paidExtracts} · cache:${cacheHits}`
        : undefined,
    );
  }

  function restoreStatusPreference(ctx: { sessionManager: { getBranch(): unknown[] } }): void {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
      if (candidate.type !== "custom" || candidate.customType !== "kagi-settings") {
        continue;
      }
      if (typeof candidate.data !== "object" || candidate.data === null) {
        continue;
      }
      const data = candidate.data as { showStatus?: unknown };
      if (typeof data.showStatus === "boolean") {
        showStatus = data.showStatus;
      }
    }
  }

  /**
   * Tallies one kagi_search/kagi_extract result into the footer counters.
   * `readKagiSource` isolates the untyped-`details` parsing; this is left
   * with only the decision the parsed value implies, so a paid call always
   * lands on the counter for its own tool and a cache hit always lands on
   * the shared one. Anything `readKagiSource` doesn't recognise — another
   * tool's result, or a Kagi result with no `details` — is silently not our
   * business, not an error.
   */
  function recordToolResult(
    event: { toolName: string; details: unknown },
    ctx: Parameters<typeof updateStatus>[0],
  ): void {
    if (event.toolName !== "kagi_search" && event.toolName !== "kagi_extract") {
      return;
    }

    const source = readKagiSource(event.details);
    if (source === undefined) {
      return;
    }

    if (source === "cache") {
      cacheHits++;
    } else if (event.toolName === "kagi_search") {
      paidSearches++;
    } else {
      paidExtracts++;
    }

    updateStatus(ctx);
  }

  const [searchTool, extractTool] = createKagiTools(
    {
      fetchImpl: fetch,
      getApiKey: () => process.env.KAGI_API_KEY,
    },
    { searchBudget, searchCache: sharedSearchCache, pageCache: sharedPageCache },
  );

  pi.on("session_start", (_event, ctx) => {
    restoreStatusPreference(ctx);
    updateStatus(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    searchBudget.beginRun();
    updateStatus(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    searchBudget.settleRun();
    updateStatus(ctx);
  });

  pi.on("tool_result", recordToolResult);

  pi.registerCommand("kagi", {
    description: "Toggle Kagi footer statistics on or off",
    handler: async (_args, ctx) => {
      showStatus = !showStatus;
      pi.appendEntry("kagi-settings", { showStatus });
      updateStatus(ctx);
    },
  });

  pi.registerTool(searchTool);
  pi.registerTool(extractTool);
}
