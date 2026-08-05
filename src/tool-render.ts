import { Text } from "@earendil-works/pi-tui";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

/**
 * Format the `(offset=X, limit=Y)` annotation for the collapsed one-liner.
 * Returns "" when both paging args are at their defaults — defaults are
 * already the obvious state, so naming them adds noise without information.
 */
export function pageAnnotation(limit: number | undefined, offset: number | undefined, defaultLimit: number): string {
  const parts: string[] = [];
  if (offset !== undefined && offset !== 1) {
    parts.push(`offset=${offset}`);
  }
  if (limit !== undefined && limit !== defaultLimit) {
    parts.push(`limit=${limit}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/**
 * The result renderer both Kagi tools share: expanded shows the tool output
 * verbatim; collapsed shows only what `renderCall` does not already display —
 * non-default paging and the cache marker.
 *
 * Taking the tool's default limit as its only parameter is what makes it
 * shared: the query and the URL are already on the call line, so nothing else
 * about the two tools differs here.
 */
export function collapsedPagingRenderer<TParams extends TSchema>(
  defaultLimit: number,
): NonNullable<ToolDefinition<TParams>["renderResult"]> {
  return (result, options, _theme, context) => {
    if (options.expanded) {
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    }

    const args = context.args as { limit?: number; offset?: number };
    const body = result.content[0];
    const cached = body?.type === "text" && body.text.includes("(from cache)");
    const paging = pageAnnotation(args.limit, args.offset, defaultLimit);

    const parts: string[] = [];
    if (paging) {
      parts.push(paging.replace(/^\(|\)$/g, ""));
    }
    if (cached) {
      parts.push("from cache");
    }
    return new Text(parts.join(" · "), 0, 0);
  };
}
