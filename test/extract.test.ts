import assert from "node:assert/strict";
import { test } from "node:test";
import { createKagiTools } from "../src/index.ts";
import { jsonResponse, NO_CTX, stubFetch, textOf } from "./helpers.ts";

const PAGE_URL = "https://example.com/article";

function makeExtractTool(fetchImpl: typeof fetch, options: { apiKey?: string } = {}) {
  const apiKey = "apiKey" in options ? options.apiKey : "test-key";
  const [, tool] = createKagiTools({ fetchImpl, getApiKey: () => apiKey });
  return tool;
}

function pageFixture(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `Line ${String(i + 1).padStart(4, "0")}`).join("\n");
}

function extractResponse(markdown: string, url = PAGE_URL) {
  return { meta: { trace: "t", ms: 1250 }, data: [{ url, markdown }] };
}

test("kagi_extract posts the URL and renders the page with a header", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(extractResponse(pageFixture(3))));

  const result = await makeExtractTool(fetchImpl).execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call?.url, "https://kagi.com/api/v1/extract");
  assert.equal(call?.init.method, "POST");
  const headers = call?.init.headers as Record<string, string>;
  assert.equal(headers["authorization"], "Bearer test-key");
  assert.deepEqual(JSON.parse(String(call?.init.body)), {
    pages: [{ url: PAGE_URL }],
    format: "json",
  });

  const text = textOf(result);
  assert.ok(text.startsWith(`# ${PAGE_URL} — 3 lines`));
  assert.ok(text.includes("Line 0001"));
  assert.ok(text.includes("Line 0003"));
  assert.ok(!text.includes("Showing lines"), "a complete page needs no paging note");
});

test("kagi_extract pages long content with limit and offset", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(extractResponse(pageFixture(500))));
  const tool = makeExtractTool(fetchImpl);

  const first = await tool.execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  const firstText = textOf(first);
  assert.ok(firstText.includes(`# ${PAGE_URL} — 500 lines`));
  assert.ok(firstText.includes("Line 0001"));
  assert.ok(firstText.includes("Line 0250"));
  assert.ok(!firstText.includes("Line 0251"), "content past the default limit stays hidden");
  assert.ok(firstText.includes("[Showing lines 1–250 of 500. Use offset: 251 for more.]"));

  const second = await tool.execute("call-2", { url: PAGE_URL, offset: 251, limit: 300 }, undefined, undefined, NO_CTX);
  const secondText = textOf(second);
  assert.ok(secondText.includes("Line 0251"));
  assert.ok(secondText.includes("Line 0500"));
  assert.ok(!secondText.includes("Showing lines"), "the final page needs no paging note");

  assert.equal(calls.length, 1, "paging a cached page must not hit the API");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    pages: [{ url: PAGE_URL }],
    format: "json",
  });
});

test("kagi_extract explains when the offset is beyond the content", async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse(extractResponse(pageFixture(500))));

  const result = await makeExtractTool(fetchImpl).execute(
    "call-1",
    { url: PAGE_URL, offset: 600 },
    undefined,
    undefined,
    NO_CTX,
  );
  const text = textOf(result);

  assert.ok(text.includes("No content at offset: 600"));
  assert.ok(text.includes("500 lines"));
});

test("kagi_extract declares limit and offset bounds in its parameter schema", () => {
  const tool = makeExtractTool(stubFetch(() => jsonResponse({})).fetchImpl);
  const { limit, offset } = tool.parameters.properties;

  assert.ok("maximum" in limit && limit.maximum === 2000);
  assert.ok("minimum" in limit && limit.minimum === 1);
  assert.ok("minimum" in offset && offset.minimum === 1);
});

test("kagi_extract serves repeat extracts of a URL from cache", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(extractResponse(pageFixture(10))));
  const tool = makeExtractTool(fetchImpl);

  const first = await tool.execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  const second = await tool.execute("call-2", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  const other = await tool.execute("call-3", { url: "https://example.com/other" }, undefined, undefined, NO_CTX);

  assert.equal(calls.length, 2, "only the distinct URL triggers a second fetch");
  assert.ok(!textOf(first).includes("(from cache)"));
  assert.ok(textOf(second).includes("(from cache)"));
  assert.ok(!textOf(other).includes("(from cache)"));
});

test("kagi_extract evicts the oldest cached page beyond 100 entries", async () => {
  const { calls, fetchImpl } = stubFetch(({ init }) => {
    const body = JSON.parse(String(init.body)) as { pages: Array<{ url: string }> };
    return jsonResponse(extractResponse(pageFixture(1), body.pages[0]?.url ?? PAGE_URL));
  });
  const tool = makeExtractTool(fetchImpl);

  for (let i = 1; i <= 101; i++) {
    await tool.execute(`call-${i}`, { url: `https://example.com/p${i}` }, undefined, undefined, NO_CTX);
  }
  assert.equal(calls.length, 101);

  const evicted = await tool.execute("call-102", { url: "https://example.com/p1" }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 102, "p1 was evicted by the 101st distinct page");
  assert.ok(!textOf(evicted).includes("(from cache)"));

  const retained = await tool.execute("call-103", { url: "https://example.com/p101" }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 102, "p101 survived eviction and stays cached");
  assert.ok(textOf(retained).includes("(from cache)"));
});

test("kagi_extract returns per-page extraction failures as ordinary content", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({ meta: { trace: "t" }, data: [{ url: PAGE_URL, error: "failed to fetch page: 403 Forbidden" }] }),
  );
  const tool = makeExtractTool(fetchImpl);

  const first = await tool.execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.ok(textOf(first).includes("Extraction failed: failed to fetch page: 403 Forbidden"));

  const second = await tool.execute("call-2", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 1, "a cached failure is not retried");
  assert.ok(textOf(second).includes("(from cache)"));
});

test("kagi_extract throws on whole-call HTTP failures", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse(
      { meta: { trace: "trace-500" }, data: null, error: [{ code: "boom", message: "It broke" }] },
      500,
    ),
  );

  await assert.rejects(
    () => makeExtractTool(fetchImpl).execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("Kagi extract failed: Kagi server error"));
      assert.ok(error.message.includes("trace-500"));
      return true;
    },
  );
});

test("kagi_extract throws setup instructions when KAGI_API_KEY is missing", async () => {
  const { calls, fetchImpl } = stubFetch(() => {
    throw new Error("fetch should not be called");
  });

  await assert.rejects(
    () => makeExtractTool(fetchImpl, { apiKey: undefined }).execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX),
    /KAGI_API_KEY/,
  );
  assert.equal(calls.length, 0);
});

test("kagi_extract times out with a plain-language message", async () => {
  const { fetchImpl } = stubFetch(
    ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );

  const [, tool] = createKagiTools({ fetchImpl, getApiKey: () => "test-key", extractTimeoutMs: 10 });
  await assert.rejects(
    () => tool.execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("timed out"));
      return true;
    },
  );
});

test("kagi_extract caps oversized output at 50KB", async () => {
  const bigPage = Array.from({ length: 1000 }, (_, i) => `Line ${String(i + 1).padStart(4, "0")} ${"x".repeat(50)}`).join("\n");
  const { fetchImpl } = stubFetch(() => jsonResponse(extractResponse(bigPage)));

  const result = await makeExtractTool(fetchImpl).execute(
    "call-1",
    { url: PAGE_URL, limit: 2000 },
    undefined,
    undefined,
    NO_CTX,
  );
  const text = textOf(result);

  assert.ok(new TextEncoder().encode(text).byteLength <= 50 * 1024, "output stays within 50KB");
  assert.ok(text.includes("[Output capped at 50KB"));
});
