import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createKagiClient } from "./client.ts";
import { formatSearchResults } from "./format.ts";

export interface KagiToolsOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
}

const searchParameters = Type.Object({
  query: Type.String({ description: "The search query" }),
});

const extractParameters = Type.Object({});

export function createKagiTools(options: KagiToolsOptions) {
  const client = createKagiClient(options);

  const searchTool: ToolDefinition<typeof searchParameters> = {
    name: "kagi_search",
    label: "Kagi Search",
    description: "Search the web with Kagi. Returns a compact markdown list of results.",
    parameters: searchParameters,
    async execute(_toolCallId, params, signal) {
      const response = await client.search(params.query, signal);
      return {
        content: [{ type: "text" as const, text: formatSearchResults(response) }],
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
