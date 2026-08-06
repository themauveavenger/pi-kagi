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
