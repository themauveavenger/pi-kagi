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
type EventHandler = (...args: never[]) => unknown;

function captureRegistrations(): {
  tools: ToolDefinition[];
  eventHandlers: Map<string, EventHandler[]>;
  commands: Map<string, { handler: EventHandler }>;
  pi: ExtensionAPI;
} {
  const tools: ToolDefinition[] = [];
  const eventHandlers = new Map<string, EventHandler[]>();
  const commands = new Map<string, { handler: EventHandler }>();
  const pi = {
    registerTool(definition: ToolDefinition) {
      tools.push(definition);
    },
    on(eventName: string, handler: EventHandler) {
      eventHandlers.set(eventName, [...(eventHandlers.get(eventName) ?? []), handler]);
    },
    registerCommand(name: string, options: { handler: EventHandler }) {
      commands.set(name, options);
    },
    appendEntry() {},
  } as unknown as ExtensionAPI;
  return { tools, eventHandlers, commands, pi };
}

function eventHandler(eventHandlers: Map<string, EventHandler[]>, eventName: string): EventHandler {
  const handler = eventHandlers.get(eventName)?.[0];
  assert.ok(handler, `extension must register a ${eventName} handler`);
  return handler;
}

test("extension registers kagi_search and kagi_extract tools", () => {
  const { tools, pi } = captureRegistrations();

  extension(pi);

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["kagi_search", "kagi_extract"],
  );
});

test("extension resets the two-search budget when an agent run settles", async () => {
  const { tools, eventHandlers, pi } = captureRegistrations();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: { search: [] } }), { status: 200 });
  }) as typeof fetch;

  try {
    extension(pi);
    const search = tools.find((tool) => tool.name === "kagi_search");
    assert.ok(search, "extension registers kagi_search");

    const lifecycleCtx = {
      ui: { setStatus() {} },
      sessionManager: { getBranch: () => [] },
    };
    await eventHandler(eventHandlers, "agent_start")({} as never, lifecycleCtx as never);
    await search.execute("one", { query: "one" }, undefined, undefined, undefined as never);
    await search.execute("two", { query: "two" }, undefined, undefined, undefined as never);
    await assert.rejects(
      () => search.execute("three", { query: "three" }, undefined, undefined, undefined as never),
      /Kagi search budget exhausted/,
    );

    await eventHandler(eventHandlers, "agent_settled")({} as never, lifecycleCtx as never);
    await eventHandler(eventHandlers, "agent_start")({} as never, lifecycleCtx as never);
    await search.execute("three", { query: "three" }, undefined, undefined, undefined as never);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("kagi footer status is visible by default and can be toggled off", async () => {
  const { eventHandlers, commands, pi } = captureRegistrations();
  const statuses: Array<string | undefined> = [];
  const ctx = {
    ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
    sessionManager: { getBranch: () => [] },
  };
  extension(pi);

  await eventHandler(eventHandlers, "session_start")({} as never, ctx as never);
  assert.ok(statuses.at(-1)?.includes("Kagi: search 0/2"));

  const command = commands.get("kagi");
  assert.ok(command, "extension registers /kagi");
  await command.handler("status off" as never, ctx as never);
  assert.equal(statuses.at(-1), undefined);
});

test("kagi footer status counts paid calls and cache hits", async () => {
  const { eventHandlers, pi } = captureRegistrations();
  const statuses: Array<string | undefined> = [];
  const ctx = {
    ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
    sessionManager: { getBranch: () => [] },
  };
  extension(pi);

  await eventHandler(eventHandlers, "session_start")({} as never, ctx as never);
  await eventHandler(eventHandlers, "tool_result")(
    { toolName: "kagi_search", details: { kagi: { source: "paid" } } } as never,
    ctx as never,
  );
  await eventHandler(eventHandlers, "tool_result")(
    { toolName: "kagi_extract", details: { kagi: { source: "cache" } } } as never,
    ctx as never,
  );

  assert.ok(statuses.at(-1)?.includes("paid S:1 E:0 · cache:1"));
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

test("kagi_search guidance limits paid searches and discourages speculative variants", () => {
  const { tools, pi } = captureRegistrations();
  extension(pi);
  const search = tools.find((tool) => tool.name === "kagi_search");
  assert.ok(search, "extension registers kagi_search");

  assert.ok(search.promptGuidelines?.some((guideline) => guideline.includes("two uncached searches")));
  assert.ok(search.promptGuidelines?.some((guideline) => guideline.includes("speculative parallel query variants")));
  for (const guideline of search.promptGuidelines ?? []) {
    assert.ok(guideline.includes("kagi_search"), `guideline must name kagi_search: "${guideline}"`);
  }
});

test("tools declare prompt snippets and cost-conscious guidelines that name the tool", () => {
  const { tools, pi } = captureRegistrations();

  extension(pi);

  for (const tool of tools) {
    assert.ok(tool.promptSnippet && tool.promptSnippet.length > 0, `${tool.name} needs a promptSnippet`);
    assert.ok(
      tool.promptGuidelines && tool.promptGuidelines.length > 0,
      `${tool.name} needs promptGuidelines`,
    );
    for (const guideline of tool.promptGuidelines) {
      // pi appends guidelines flat to the Guidelines section with no tool
      // name prefix, so each must name its tool to be attributable.
      assert.ok(guideline.includes("kagi_"), `guideline must name its tool: "${guideline}"`);
    }
  }
});
