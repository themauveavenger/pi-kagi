import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBoundedCache } from "./cache.ts";
import { createKagiClient, type PageOutput, type SearchResponse } from "./client.ts";
import { createExtractTool, PAGE_CACHE_MAX_ENTRIES } from "./extract-tool.ts";
import { createSearchTool, SEARCH_CACHE_MAX_ENTRIES } from "./search-tool.ts";
import SearchBudget from "./search-budget.ts";

export interface KagiToolsOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
  extractTimeoutMs?: number;
}

export function createKagiTools(
  options: KagiToolsOptions,
  dependencies: { searchBudget?: SearchBudget } = {},
): [ReturnType<typeof createSearchTool>, ReturnType<typeof createExtractTool>] {
  const client = createKagiClient(options);
  // Lives as long as the registered tools — shared across sessions, no TTL.
  const searchCache = createBoundedCache<string, SearchResponse>(SEARCH_CACHE_MAX_ENTRIES);
  const pageCache = createBoundedCache<string, PageOutput>(PAGE_CACHE_MAX_ENTRIES);

  return [createSearchTool(client, searchCache, dependencies.searchBudget), createExtractTool(client, pageCache)];
}

export default function (pi: ExtensionAPI) {
  const searchBudget = new SearchBudget(2);
  let showStatus = true;
  let paidSearches = 0;
  let paidExtracts = 0;
  let cacheHits = 0;

  function updateStatus(ctx: { ui: { setStatus(key: string, value: string | undefined): void } }): void {
    ctx.ui.setStatus(
      "kagi",
      showStatus
        ? `Kagi: search ${searchBudget.getUsed()}/${searchBudget.getLimit()} this run · paid S:${paidSearches} E:${paidExtracts} · cache:${cacheHits}`
        : undefined,
    );
  }

  function restoreStatusPreference(ctx: { sessionManager: { getBranch(): unknown[] } }): void {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (typeof entry !== "object" || entry === null) continue;
      const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
      if (candidate.type !== "custom" || candidate.customType !== "kagi-settings") continue;
      if (typeof candidate.data !== "object" || candidate.data === null) continue;
      const data = candidate.data as { showStatus?: unknown };
      if (typeof data.showStatus === "boolean") showStatus = data.showStatus;
    }
  }
  const [searchTool, extractTool] = createKagiTools(
    {
      fetchImpl: fetch,
      getApiKey: () => process.env.KAGI_API_KEY,
    },
    { searchBudget },
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
  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "kagi_search" && event.toolName !== "kagi_extract") return;
    const details = event.details;
    if (typeof details !== "object" || details === null) return;
    const kagi = (details as { kagi?: unknown }).kagi;
    if (typeof kagi !== "object" || kagi === null) return;
    const source = (kagi as { source?: unknown }).source;
    if (source === "cache") {
      cacheHits++;
    } else if (source === "paid") {
      if (event.toolName === "kagi_search") paidSearches++;
      else paidExtracts++;
    } else {
      return;
    }
    updateStatus(ctx);
  });
  pi.registerCommand("kagi", {
    description: "Show or hide Kagi footer statistics: /kagi status on|off",
    handler: async (args, ctx) => {
      const setting = args.trim().match(/^status\s+(on|off)$/i)?.[1]?.toLowerCase();
      if (setting === undefined) {
        ctx.ui.notify("Usage: /kagi status on|off", "info");
        return;
      }
      showStatus = setting === "on";
      pi.appendEntry("kagi-settings", { showStatus });
      updateStatus(ctx);
    },
  });

  pi.registerTool(searchTool);
  pi.registerTool(extractTool);
}
