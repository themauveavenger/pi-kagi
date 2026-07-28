/**
 * Format the `(offset=X, limit=Y)` annotation for the collapsed one-liner.
 * Returns "" when both paging args are at their defaults — defaults are
 * already the obvious state, so naming them adds noise without information.
 */
export function pageAnnotation(limit: number | undefined, offset: number | undefined, defaultLimit: number): string {
  const parts: string[] = [];
  if (offset !== undefined && offset !== 1) parts.push(`offset=${offset}`);
  if (limit !== undefined && limit !== defaultLimit) parts.push(`limit=${limit}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
