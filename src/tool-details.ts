/**
 * The `details` shape kagi_search and kagi_extract attach to their tool
 * results, so pi's footer (and anything else watching `tool_result`) can
 * tell a paid call from a cache hit without re-parsing the rendered text.
 *
 * This is the single source of truth for that shape: search-tool.ts and
 * extract-tool.ts are typed against it when they build a result, and
 * `readKagiSource` is how index.ts reads it back out of the untyped
 * `details` field on a `tool_result` event. One type, one parser, instead
 * of the shape being duplicated (and able to drift) between producer and
 * consumer.
 */
export type KagiToolSource = "cache" | "paid";

export interface KagiToolDetails {
  kagi: { source: KagiToolSource };
}

/**
 * Narrows an untyped `tool_result` event's `details` field down to the
 * source a Kagi tool recorded, or `undefined` for anything that isn't that
 * shape — a tool that isn't ours, an error result with no `details`, or a
 * malformed payload. Callers treat `undefined` as "not a Kagi tool result",
 * not as an error.
 */
export function readKagiSource(details: unknown): KagiToolSource | undefined {
  if (typeof details !== "object" || details === null) {return undefined;}
  const kagi = (details as { kagi?: unknown }).kagi;
  if (typeof kagi !== "object" || kagi === null) {return undefined;}
  const source = (kagi as { source?: unknown }).source;
  return source === "cache" || source === "paid" ? source : undefined;
}
