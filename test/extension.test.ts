import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { resetSharedCaches } from "../src/index.ts";

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
    appendEntry() {
      return undefined;
    },
  } as unknown as ExtensionAPI;
  return { tools, eventHandlers, commands, pi };
}

function eventHandler(eventHandlers: Map<string, EventHandler[]>, eventName: string): EventHandler {
  const handler = eventHandlers.get(eventName)?.[0];
  assert.ok(handler, `extension must register a ${eventName} handler`);
  return handler;
}

// The search and page caches live in module scope so they survive a session
// switch, which also means they survive between tests. Empty them so no
// case can be handed a cache hit left behind by an earlier one.
beforeEach(() => {
  resetSharedCaches();
});

test("extension registers kagi_search and kagi_extract tools", () => {
  const { tools, pi } = captureRegistrations();

  extension(pi);

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["kagi_search", "kagi_extract"],
  );
});

test("extension preserves a settled run's search count and resets it when the next run begins", async () => {
  const { tools, eventHandlers, pi } = captureRegistrations();
  const originalFetch = globalThis.fetch;
  const statuses: (string | undefined)[] = [];
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
      ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
      sessionManager: { getBranch: () => [] },
    };
    const agentStart = eventHandler(eventHandlers, "agent_start");
    await agentStart({} as never, lifecycleCtx as never);
    await search.execute("one", { query: "one" }, undefined, undefined, undefined as never);
    await agentStart({} as never, lifecycleCtx as never);
    assert.ok(statuses.at(-1)?.includes("search 1/2 this run"), "a partially used live run shows its remaining allowance");
    assert.ok(!statuses.at(-1)?.includes("limit reached"), "a partially used live run is not reported as exhausted");

    await search.execute("two", { query: "two" }, undefined, undefined, undefined as never);
    await assert.rejects(
      () => search.execute("three", { query: "three" }, undefined, undefined, undefined as never),
      /Kagi search budget exhausted/,
    );

    await agentStart({} as never, lifecycleCtx as never);
    assert.ok(
      statuses.at(-1)?.includes("search 2/2 this run (limit reached)"),
      "a repeated start does not reset the active run, and an exhausted live run says so",
    );

    await eventHandler(eventHandlers, "agent_settled")({} as never, lifecycleCtx as never);
    assert.ok(statuses.at(-1)?.includes("search 2/2 last run"), "the settled run remains visible in the footer");
    assert.ok(statuses.at(-1)?.includes("resets next run"), "a settled run that hit the limit promises the reset");

    await agentStart({} as never, lifecycleCtx as never);
    assert.ok(statuses.at(-1)?.includes("search 0/2 this run"), "the next run receives a fresh budget");
    await search.execute("three", { query: "three" }, undefined, undefined, undefined as never);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("kagi footer status is visible by default and toggles with each /kagi call", async () => {
  const { eventHandlers, commands, pi } = captureRegistrations();
  const statuses: (string | undefined)[] = [];
  const ctx = {
    ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
    sessionManager: { getBranch: () => [] },
  };
  extension(pi);

  await eventHandler(eventHandlers, "session_start")({} as never, ctx as never);
  assert.ok(statuses.at(-1)?.includes("Kagi: search 0/2"));

  const command = commands.get("kagi");
  assert.ok(command, "extension registers /kagi");

  await command.handler("" as never, ctx as never);
  assert.equal(statuses.at(-1), undefined, "the first call hides the footer");

  await command.handler("" as never, ctx as never);
  assert.ok(statuses.at(-1)?.includes("Kagi: search 0/2"), "the second call restores it");
});

test("a session with no run yet reports the cap as a per-run allowance, not a spent budget", async () => {
  const { eventHandlers, pi } = captureRegistrations();
  const statuses: (string | undefined)[] = [];
  const ctx = {
    ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
    sessionManager: { getBranch: () => [] },
  };
  extension(pi);

  // Startup, and equally a resumed or forked session: pi re-invokes the
  // extension factory, so the budget has no run to report.
  await eventHandler(eventHandlers, "session_start")({} as never, ctx as never);
  assert.ok(statuses.at(-1)?.includes("search 0/2 per run"), "an idle budget describes the allowance");
  assert.ok(!statuses.at(-1)?.includes("last run"), "an idle budget must not claim a run happened");

  // A stray settle without a run must not invent a "last run" either.
  await eventHandler(eventHandlers, "agent_settled")({} as never, ctx as never);
  assert.ok(statuses.at(-1)?.includes("search 0/2 per run"), "settling without a run leaves the budget idle");
});

test("a settled run that spent nothing does not advertise a reset", async () => {
  const { eventHandlers, pi } = captureRegistrations();
  const statuses: (string | undefined)[] = [];
  const ctx = {
    ui: { setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
    sessionManager: { getBranch: () => [] },
  };
  extension(pi);

  await eventHandler(eventHandlers, "agent_start")({} as never, ctx as never);
  await eventHandler(eventHandlers, "agent_settled")({} as never, ctx as never);

  assert.ok(statuses.at(-1)?.includes("search 0/2 last run"), "the settled run is still reported");
  assert.ok(!statuses.at(-1)?.includes("resets next run"), "there is no spent budget to promise back");
});

test("kagi footer status counts paid calls and cache hits", async () => {
  const { eventHandlers, pi } = captureRegistrations();
  const statuses: (string | undefined)[] = [];
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

test("caches outlive the extension factory so a resumed or new session still reads them", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAGI_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: { search: [] } }), { status: 200 });
  }) as typeof fetch;
  process.env.KAGI_API_KEY = "test-key";

  try {
    // pi re-invokes the extension factory for each new/resumed session
    // rather than re-importing the module, so two loads stand in for a
    // session switch.
    const first = captureRegistrations();
    extension(first.pi);
    const firstSearch = first.tools.find((tool) => tool.name === "kagi_search");
    assert.ok(firstSearch, "extension registers kagi_search");
    await eventHandler(first.eventHandlers, "agent_start")(
      {} as never,
      {
        ui: { setStatus: () => undefined },
        sessionManager: { getBranch: () => [] },
      } as never,
    );
    await firstSearch.execute("call-1", { query: "shared" }, undefined, undefined, undefined as never);
    assert.equal(calls, 1, "the first session pays for the search");

    const second = captureRegistrations();
    extension(second.pi);
    const secondSearch = second.tools.find((tool) => tool.name === "kagi_search");
    assert.ok(secondSearch, "extension registers kagi_search");
    await eventHandler(second.eventHandlers, "agent_start")(
      {} as never,
      {
        ui: { setStatus: () => undefined },
        sessionManager: { getBranch: () => [] },
      } as never,
    );
    const result = await secondSearch.execute("call-2", { query: "shared" }, undefined, undefined, undefined as never);

    assert.equal(calls, 1, "the second session reuses the cached result set");
    assert.deepEqual(result.details, { kagi: { source: "cache" } });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.KAGI_API_KEY;
    } else {
      process.env.KAGI_API_KEY = originalKey;
    }
  }
});

test("resetSharedCaches empties the caches that outlive the factory", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAGI_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: { search: [] } }), { status: 200 });
  }) as typeof fetch;
  process.env.KAGI_API_KEY = "test-key";

  try {
    const { tools, eventHandlers, pi } = captureRegistrations();
    extension(pi);
    const search = tools.find((tool) => tool.name === "kagi_search");
    assert.ok(search, "extension registers kagi_search");
    await eventHandler(eventHandlers, "agent_start")(
      {} as never,
      {
        ui: { setStatus: () => undefined },
        sessionManager: { getBranch: () => [] },
      } as never,
    );

    await search.execute("call-1", { query: "resettable" }, undefined, undefined, undefined as never);
    await search.execute("call-2", { query: "resettable" }, undefined, undefined, undefined as never);
    assert.equal(calls, 1, "the repeat is served from cache");

    resetSharedCaches();
    const result = await search.execute("call-3", { query: "resettable" }, undefined, undefined, undefined as never);

    assert.equal(calls, 2, "after a reset the same query pays again");
    assert.deepEqual(result.details, { kagi: { source: "paid" } });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.KAGI_API_KEY;
    } else {
      process.env.KAGI_API_KEY = originalKey;
    }
  }
});

test("registered tools carry the metadata pi needs to present them", () => {
  const { tools, pi } = captureRegistrations();

  extension(pi);

  for (const tool of tools) {
    assert.ok(tool.label.length > 0, `${tool.name} needs a label`);
    assert.ok(tool.description.length > 0, `${tool.name} needs a description`);
    assert.ok("type" in tool.parameters && tool.parameters.type === "object", `${tool.name} needs an object schema`);
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
    assert.ok(tool.promptGuidelines && tool.promptGuidelines.length > 0, `${tool.name} needs promptGuidelines`);
    for (const guideline of tool.promptGuidelines) {
      // pi appends guidelines flat to the Guidelines section with no tool
      // name prefix, so each must name its tool to be attributable.
      assert.ok(guideline.includes("kagi_"), `guideline must name its tool: "${guideline}"`);
    }
  }
});
