import type { ExtensionAPI, ExtensionContext, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Static } from "typebox";

export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "kagi_search",
    description: "",
    promptSnippet: "",
    promptGuidelines: [],
    execute: async () => {},
    label: "",
    parameters: undefined
  });

  pi.registerTool({
    name: "kagi_extract",
    description: "",
    promptSnippet: "",
    promptGuidelines: [],
    execute: async () => {},
    label: "",
    parameters: undefined
  });
}
