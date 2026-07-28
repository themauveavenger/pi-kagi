import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBoundedCache } from "./cache.ts";
import { createKagiClient, type PageOutput, type SearchResponse } from "./client.ts";
import { createExtractTool, PAGE_CACHE_MAX_ENTRIES } from "./extract-tool.ts";
import { createSearchTool, SEARCH_CACHE_MAX_ENTRIES } from "./search-tool.ts";

export interface KagiToolsOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
  extractTimeoutMs?: number;
}

export function createKagiTools(
  options: KagiToolsOptions,
): [ReturnType<typeof createSearchTool>, ReturnType<typeof createExtractTool>] {
  const client = createKagiClient(options);
  // Lives as long as the registered tools — shared across sessions, no TTL.
  const searchCache = createBoundedCache<string, SearchResponse>(SEARCH_CACHE_MAX_ENTRIES);
  const pageCache = createBoundedCache<string, PageOutput>(PAGE_CACHE_MAX_ENTRIES);

  return [createSearchTool(client, searchCache), createExtractTool(client, pageCache)];
}

export default function (pi: ExtensionAPI) {
  const [searchTool, extractTool] = createKagiTools({
    fetchImpl: fetch,
    getApiKey: () => process.env.KAGI_API_KEY,
  });
  pi.registerTool(searchTool);
  pi.registerTool(extractTool);
}
