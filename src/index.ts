import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createBoundedCache } from "./cache.ts";
import { createKagiClient, type SearchResponse } from "./client.ts";
import { formatSearchResults } from "./format.ts";

export interface KagiToolsOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
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

const extractParameters = Type.Object({});

const SEARCH_CACHE_MAX_ENTRIES = 50;

export function createKagiTools(
  options: KagiToolsOptions,
): [ToolDefinition<typeof searchParameters>, ToolDefinition<typeof extractParameters>] {
  const client = createKagiClient(options);
  // Lives as long as the registered tools — shared across sessions, no TTL.
  const searchCache = createBoundedCache<string, SearchResponse>(SEARCH_CACHE_MAX_ENTRIES);

  const searchTool: ToolDefinition<typeof searchParameters> = {
    name: "kagi_search",
    label: "Kagi Search",
    description: "Search the web with Kagi. Returns a compact markdown list of results.",
    parameters: searchParameters,
    async execute(_toolCallId, params, signal) {
      const limit = params.limit ?? 10;
      const offset = params.offset ?? 1;

      const cached = searchCache.get(params.query);
      const response = cached ?? (await client.search(params.query, signal));
      if (!cached) {
        searchCache.set(params.query, response);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatSearchResults(response, {
              query: params.query,
              limit,
              offset,
              fromCache: cached !== undefined,
            }),
          },
        ],
        details: {},
      };
    },
  };

  const extractTool: ToolDefinition<typeof extractParameters> = {
    name: "kagi_extract",
    label: "Kagi Extract",
    description: "Extract page content as markdown with Kagi.",
    parameters: extractParameters,
    async execute() {
      return {
        content: [{ type: "text" as const, text: "kagi_extract is not implemented yet." }],
        details: {},
      };
    },
  };

  return [searchTool, extractTool];
}

export default function (pi: ExtensionAPI) {
  const tools = createKagiTools({
    fetchImpl: fetch,
    getApiKey: () => process.env.KAGI_API_KEY,
  });
  for (const tool of tools) {
    pi.registerTool(tool);
  }
}
