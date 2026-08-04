import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BoundedCache } from "./cache.ts";
import type { KagiClient, PageOutput } from "./client.ts";
import { capOutputBytes, formatExtractedPage } from "./format.ts";
import { pageAnnotation } from "./tool-render.ts";

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

export const PAGE_CACHE_MAX_ENTRIES = 100;
const DEFAULT_EXTRACT_LIMIT = 250;

export function createExtractTool(
  client: KagiClient,
  pageCache: BoundedCache<string, PageOutput>,
): ToolDefinition<typeof extractParameters> {
  return {
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
        details: { kagi: { source: fromCache ? "cache" : "paid" } },
      };
    },
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("kagi_extract"))} ${(args as { url: string }).url}`, 0, 0);
    },
    renderResult(result, options, _theme, context) {
      if (!options.expanded) {
        const args = context.args as { url: string; limit?: number; offset?: number };
        const body = result.content[0];
        const cached = body?.type === "text" && body.text.includes("(from cache)");
        const paging = pageAnnotation(args.limit, args.offset, DEFAULT_EXTRACT_LIMIT);
        // renderCall already shows the URL — collapsed result only adds
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
