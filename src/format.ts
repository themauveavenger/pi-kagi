import type { SearchResponse, SearchResultItem } from "./client.ts";

const SNIPPET_MAX_LENGTH = 240;

export function formatSearchResults(response: SearchResponse): string {
  const data = response.data ?? {};
  const kinds = Object.keys(data)
    .filter((kind) => (data[kind]?.length ?? 0) > 0)
    .sort((a, b) => {
      if (a === "search") return -1;
      if (b === "search") return 1;
      return 0;
    });

  if (kinds.length === 0) {
    return "No results found.";
  }

  const sections: string[] = [];
  for (const kind of kinds) {
    const items = data[kind] ?? [];
    const body = items.map((item, index) => formatItem(item, index)).join("\n\n");
    sections.push(kind === "search" ? body : `## ${humanize(kind)}\n\n${body}`);
  }
  return sections.join("\n\n");
}

function formatItem(item: SearchResultItem, index: number): string {
  const date = item.time?.slice(0, 10);
  const link = item.url ? `[${item.title}](${item.url})` : item.title;
  const heading = `${index + 1}. ${link}${date ? ` — ${date}` : ""}`;
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
