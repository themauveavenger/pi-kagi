import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createBoundedCache } from "./cache.ts";
import { createKagiClient, type PageOutput, type SearchResponse } from "./client.ts";
import { capOutputBytes, formatExtractedPage, formatSearchResults } from "./format.ts";

export interface KagiToolsOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
  extractTimeoutMs?: number;
}

const searchParameters = Type.Object({
  query: Type.String({ description: "The search query" }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 25,
      default: 10,
      description: "Maximum number of web results to show (default 10)",
    }),
  ),
  offset: Type.Optional(
    Type.Integer({
      minimum: 1,
      default: 1,
      description: "1-based index of the first result to show; page without issuing a new search (default 1)",
    }),
  ),
});

const extractParameters = Type.Object({
  url: Type.String({ description: "The HTTPS URL of the page to extract content from" }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 2000,
      default: 250,
      description: "Maximum number of lines of page content to return (default 250)",
    }),
  ),
  offset: Type.Optional(
    Type.Integer({
      minimum: 1,
      default: 1,
      description: "1-based line number to start from; page through long content (default 1)",
    }),
  ),
  refresh: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Bypass the cache for this call and overwrite the cached page with the fresh result",
    }),
  ),
});

const SEARCH_CACHE_MAX_ENTRIES = 50;
const PAGE_CACHE_MAX_ENTRIES = 100;

export function createKagiTools(
  options: KagiToolsOptions,
): [ToolDefinition<typeof searchParameters>, ToolDefinition<typeof extractParameters>] {
  const client = createKagiClient(options);
  // Lives as long as the registered tools — shared across sessions, no TTL.
  const searchCache = createBoundedCache<string, SearchResponse>(SEARCH_CACHE_MAX_ENTRIES);
  const pageCache = createBoundedCache<string, PageOutput>(PAGE_CACHE_MAX_ENTRIES);

  const searchTool: ToolDefinition<typeof searchParameters> = {
    name: "kagi_search",
    label: "Kagi Search",
    description:
      "Search the web with Kagi, a metered web-search API (kagi.com/api). " +
      "Returns a compact markdown list of results. " +
      "Identical queries and paging are served from an in-memory cache, so they cost nothing.",
    promptSnippet:
      "Search the web with Kagi, a metered web-search API (kagi.com/api); returns compact markdown results, cached paging",
    promptGuidelines: [
      "Use kagi_search before considering kagi_extract; search snippets often answer the question on their own.",
      "When kagi_search results are insufficient, page deeper with kagi_search's offset parameter instead of rephrasing or repeating the same query.",
    ],
    parameters: searchParameters,
    async execute(_toolCallId, params, signal) {
      const limit = params.limit ?? 10;
      const offset = params.offset ?? 1;

      const { value: response, fromCache } = await searchCache.lookup(params.query, (query) =>
        client.search(query, signal),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: capOutputBytes(
              formatSearchResults(response, {
                query: params.query,
                limit,
                offset,
                fromCache,
              }),
            ),
          },
        ],
        details: {},
      };
    },
  };

  const extractTool: ToolDefinition<typeof extractParameters> = {
    name: "kagi_extract",
    label: "Kagi Extract",
    description:
      "Extract a web page's content as markdown via Kagi, a metered web-search API (kagi.com/api). " +
      "Long pages are paged with offset and limit, like the read tool. " +
      "Each uncached URL is a paid Kagi API call; extracted pages are cached.",
    promptSnippet:
      "Extract a web page as markdown via Kagi, a metered web-search API (kagi.com/api); paged like the read tool",
    promptGuidelines: [
      "Use kagi_extract only on URLs you intend to read; each uncached kagi_extract URL costs a paid Kagi API call.",
      "Page through long kagi_extract content with offset and limit rather than re-requesting the same URL at a larger limit.",
      "Use kagi_extract's refresh parameter only when a cached page may be stale (a live or recently updated page); normal offset/limit paging never needs refresh, and a failed extract auto-retries on the next call without it.",
      "Use kagi_extract for remote https URLs and the read tool for local file paths.",
    ],
    parameters: extractParameters,
    async execute(_toolCallId, params, signal) {
      const limit = params.limit ?? 250;
      const offset = params.offset ?? 1;
      const refresh = params.refresh ?? false;

      // A per-page extraction failure is not a successful result — don't pin
      // it in the cache, or every later call for this URL returns the same
      // failure without retrying. Passing the predicate to the cache keeps
      // the bad value out of the store entirely, so it can never evict a
      // good page to make room for one we'd then drop. The value is still
      // returned for the current call's output; only the cache write is
      // skipped.
      const cacheable = (page: PageOutput) => page.error === undefined;
      const miss = (url: string) => client.extract(url, signal);

      const { value: page, fromCache } = await (refresh
        ? pageCache.refresh(params.url, miss, cacheable)
        : pageCache.lookup(params.url, miss, cacheable));

      return {
        content: [
          {
            type: "text" as const,
            text: capOutputBytes(formatExtractedPage(page, { limit, offset, fromCache })),
          },
        ],
        details: {},
      };
    },
  };

  return [searchTool, extractTool];
}

export default function (pi: ExtensionAPI) {
  const [searchTool, extractTool] = createKagiTools({
    fetchImpl: fetch,
    getApiKey: () => process.env.KAGI_API_KEY,
  });
  pi.registerTool(searchTool);
  pi.registerTool(extractTool);
}
