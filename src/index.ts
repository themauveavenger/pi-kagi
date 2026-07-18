import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "kagi_search",
    label: "Kagi Search",
    description: "Search the web with Kagi.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text" as const, text: "kagi_search is not implemented yet." }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "kagi_extract",
    label: "Kagi Extract",
    description: "Extract page content as markdown with Kagi.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text" as const, text: "kagi_extract is not implemented yet." }],
        details: {},
      };
    },
  });
}
