import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BoundedCache } from "./cache.ts";
import type { KagiClient, SearchResponse } from "./client.ts";
import { capOutputBytes, formatSearchResults } from "./format.ts";
import { pageAnnotation } from "./tool-render.ts";

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

export const SEARCH_CACHE_MAX_ENTRIES = 50;
const DEFAULT_SEARCH_LIMIT = 10;

export function createSearchTool(
  client: KagiClient,
  searchCache: BoundedCache<string, SearchResponse>,
): ToolDefinition<typeof searchParameters> {
  return {
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
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("kagi_search"))} ${(args as { query: string }).query}`, 0, 0);
    },
    renderResult(result, options, _theme, context) {
      if (!options.expanded) {
        const args = context.args as { query: string; limit?: number; offset?: number };
        const body = result.content[0];
        const cached = body?.type === "text" && body.text.includes("(from cache)");
        const paging = pageAnnotation(args.limit, args.offset, DEFAULT_SEARCH_LIMIT);
        // renderCall already shows the query — collapsed result only adds
        // supplementary info (paging, cache).
        const parts: string[] = [];
        if (paging) parts.push(paging.replace(/^\(|\)$/g, ""));
        if (cached) parts.push("from cache");
        return new Text(parts.join(" · "), 0, 0);
      }
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    },
  };
}
