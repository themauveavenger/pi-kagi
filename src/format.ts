import type { SearchResponse, SearchResultItem } from "./client.ts";

const SNIPPET_MAX_LENGTH = 240;

export interface SearchFormatOptions {
  query: string;
  limit: number;
  offset: number;
  fromCache?: boolean;
}

export function formatSearchResults(response: SearchResponse, options: SearchFormatOptions): string {
  const { query, limit, offset, fromCache = false } = options;
  const data = response.data ?? {};
  const searchItems = data.search ?? [];
  const total = searchItems.length;

  const otherKinds = Object.keys(data).filter((kind) => kind !== "search" && (data[kind]?.length ?? 0) > 0);

  if (total === 0 && otherKinds.length === 0) {
    return "No results found.";
  }

  const sections: string[] = [];

  if (total > 0) {
    if (offset > total) {
      sections.push(
        `No results at offset: ${offset} — "${query}" has ${total} results.${fromCache ? " (from cache)" : ""}`,
      );
    } else {
      const slice = searchItems.slice(offset - 1, offset - 1 + limit);
      sections.push(slice.map((item, index) => formatItem(item, offset + index)).join("\n\n"));

      if (fromCache || total > limit || offset > 1) {
        const end = offset + slice.length - 1;
        const cacheMarker = fromCache ? " (from cache)" : "";
        let footer = `Showing results ${offset}–${end} of ${total} for "${query}"${cacheMarker}.`;
        if (end < total) {
          footer += ` Use offset: ${end + 1} for more results.`;
        }
        sections.push(footer);
      }
    }
  }

  for (const kind of otherKinds) {
    const items = data[kind] ?? [];
    const body = items.map((item, index) => formatItem(item, index + 1)).join("\n\n");
    sections.push(`## ${humanize(kind)}\n\n${body}`);
  }

  return sections.join("\n\n");
}

function formatItem(item: SearchResultItem, position: number): string {
  const date = item.time?.slice(0, 10);
  const link = item.url ? `[${item.title}](${item.url})` : item.title;
  const heading = `${position}. ${link}${date ? ` — ${date}` : ""}`;
  const snippet = item.snippet ? truncateSnippet(item.snippet) : undefined;
  return snippet ? `${heading}\n   ${snippet}` : heading;
}

function truncateSnippet(snippet: string): string {
  const flat = snippet.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX_LENGTH ? `${flat.slice(0, SNIPPET_MAX_LENGTH - 1)}…` : flat;
}

function humanize(kind: string): string {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
