import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

/**
 * Stands in for pi's full ExtensionAPI at the module boundary, capturing
 * only what the extension registers. The cast is deliberate: tests drive
 * the extension through its public entry point without booting pi.
 */
function captureRegistrations(): { tools: ToolDefinition[]; pi: ExtensionAPI } {
  const tools: ToolDefinition[] = [];
  const pi = {
    registerTool(definition: ToolDefinition) {
      tools.push(definition);
    },
  } as unknown as ExtensionAPI;
  return { tools, pi };
}

test("extension registers kagi_search and kagi_extract tools", () => {
  const { tools, pi } = captureRegistrations();

  extension(pi);

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["kagi_search", "kagi_extract"],
  );
});

test("registered tools carry the metadata pi needs to present them", () => {
  const { tools, pi } = captureRegistrations();

  extension(pi);

  for (const tool of tools) {
    assert.ok(tool.label.length > 0, `${tool.name} needs a label`);
    assert.ok(tool.description.length > 0, `${tool.name} needs a description`);
    assert.ok(
      "type" in tool.parameters && tool.parameters.type === "object",
      `${tool.name} needs an object schema`,
    );
  }
});
