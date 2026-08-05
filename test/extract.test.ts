import assert from "node:assert/strict";
import { test } from "node:test";
import { createKagiTools } from "../src/index.ts";
import { KagiApiError, KagiTimeoutError } from "../src/errors.ts";
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

test("kagi_extract declares a refresh parameter in its schema", () => {
  const tool = makeExtractTool(stubFetch(() => jsonResponse({})).fetchImpl);
  const { refresh } = tool.parameters.properties;

  assert.ok(refresh, "the schema includes a refresh property");
  assert.ok("type" in refresh && refresh.type === "boolean");
  assert.ok("default" in refresh && refresh.default === false);
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
    const body = JSON.parse(String(init.body)) as { pages: { url: string }[] };
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

test("kagi_extract returns per-page extraction failures as ordinary content and does not cache them", async () => {
  const stub = stubFetch(() => {
    // First two calls return a per-page error; later calls return a successful page.
    if (stub.calls.length <= 2) {
      return jsonResponse({
        meta: { trace: "t" },
        data: [{ url: PAGE_URL, error: "failed to fetch page: 403 Forbidden" }],
      });
    }
    return jsonResponse(extractResponse(pageFixture(3)));
  });
  const { calls, fetchImpl } = stub;
  const tool = makeExtractTool(fetchImpl);

  const first = await tool.execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.ok(textOf(first).includes("Extraction failed: failed to fetch page: 403 Forbidden"));
  assert.equal(calls.length, 1, "first call hits the API");

  const second = await tool.execute("call-2", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 2, "a failed extract is not cached, so the next call re-fetches");
  assert.ok(!textOf(second).includes("(from cache)"), "the re-fetched failure is not from cache");

  const third = await tool.execute("call-3", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 3, "a successful extract is fetched fresh");
  assert.ok(!textOf(third).includes("(from cache)"));

  const fourth = await tool.execute("call-4", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 3, "the success is now cached, so the fourth call is served from cache");
  assert.ok(textOf(fourth).includes("(from cache)"));
});

test("kagi_extract bypasses the cache and writes back when refresh is true", async () => {
  const original = "Line 0001 original\nLine 0002\nLine 0003";
  const refreshed = "Line 0001 refreshed\nLine 0002\nLine 0003";
  const stub = stubFetch(() => {
    // The first fetch returns the original; every later fetch returns the refreshed content.
    return jsonResponse(extractResponse(stub.calls.length === 1 ? original : refreshed));
  });
  const { calls, fetchImpl } = stub;
  const tool = makeExtractTool(fetchImpl);

  // First call: caches the original content.
  const first = await tool.execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.ok(textOf(first).includes("original"));
  assert.ok(!textOf(first).includes("refreshed"));
  assert.equal(calls.length, 1);

  // Second call without refresh: served from cache.
  const second = await tool.execute("call-2", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.ok(textOf(second).includes("original"));
  assert.ok(textOf(second).includes("(from cache)"));
  assert.equal(calls.length, 1, "no new fetch on a plain cache hit");

  // Third call with refresh=true: re-fetches and stores the new content.
  const third = await tool.execute("call-3", { url: PAGE_URL, refresh: true }, undefined, undefined, NO_CTX);
  assert.ok(textOf(third).includes("refreshed"), "the refreshed call returns the fresh content");
  assert.ok(!textOf(third).includes("original"));
  assert.ok(!textOf(third).includes("(from cache)"), "the fresh fetch is not marked as from cache");
  assert.equal(calls.length, 2);

  // Fourth call without refresh: now served from the refreshed cache entry.
  const fourth = await tool.execute("call-4", { url: PAGE_URL }, undefined, undefined, NO_CTX);
  assert.ok(textOf(fourth).includes("refreshed"), "the refreshed value is now in the cache");
  assert.ok(textOf(fourth).includes("(from cache)"));
  assert.equal(calls.length, 2, "the refresh wrote back; no third fetch");
});

test("a per-page extraction failure never evicts a cached page to make room for itself", async () => {
  const { calls, fetchImpl } = stubFetch(({ init }) => {
    const body = JSON.parse(String(init.body)) as { pages: { url: string }[] };
    const url = body.pages[0]?.url ?? PAGE_URL;
    // The 101st distinct URL fails; every other URL extracts normally.
    if (url.endsWith("/p101")) {
      return jsonResponse({ meta: { trace: "t" }, data: [{ url, error: "failed to fetch page: 403 Forbidden" }] });
    }
    return jsonResponse(extractResponse(pageFixture(1), url));
  });
  const tool = makeExtractTool(fetchImpl);

  // Fill the page cache to exactly its capacity of 100 distinct pages.
  for (let i = 1; i <= 100; i++) {
    await tool.execute(`call-${i}`, { url: `https://example.com/p${i}` }, undefined, undefined, NO_CTX);
  }
  assert.equal(calls.length, 100);

  // The 101st distinct URL returns a per-page failure. Previously this
  // would store the error, evict the oldest cached page (p1) to make room,
  // and only then delete the error — silently losing a good cache entry.
  const failed = await tool.execute("call-fail", { url: "https://example.com/p101" }, undefined, undefined, NO_CTX);
  assert.ok(textOf(failed).includes("Extraction failed: failed to fetch page: 403 Forbidden"));
  assert.equal(calls.length, 101, "the failed extract hit the API");

  // p1 must still be in the cache: the failure was never written, so it
  // never displaced anything.
  const stillCached = await tool.execute(
    "call-p1-again",
    { url: "https://example.com/p1" },
    undefined,
    undefined,
    NO_CTX,
  );
  assert.ok(textOf(stillCached).includes("(from cache)"), "p1 was not evicted by the failed extract");
  assert.equal(calls.length, 101, "no new fetch — p1 came from the cache");

  // And the error URL itself must not be cached: retrying it fetches again.
  await tool.execute("call-fail-retry", { url: "https://example.com/p101" }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 102, "the failed URL is not cached, so retrying it re-fetches");
});

test("kagi_extract throws on whole-call HTTP failures", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({ meta: { trace: "trace-500" }, data: null, error: [{ code: "boom", message: "It broke" }] }, 500),
  );

  await assert.rejects(
    () => makeExtractTool(fetchImpl).execute("call-1", { url: PAGE_URL }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof KagiApiError);
      assert.equal(error.operation, "extract", "the operation names the failing capability");
      assert.equal(error.status, 500);
      assert.equal(error.trace, "trace-500");
      assert.ok(error.message.includes("Kagi extract failed: Kagi server error"));
      return true;
    },
  );
});

test("kagi_extract throws setup instructions when KAGI_API_KEY is missing", async () => {
  const { calls, fetchImpl } = stubFetch(() => {
    throw new Error("fetch should not be called");
  });

  await assert.rejects(
    () =>
      makeExtractTool(fetchImpl, { apiKey: undefined }).execute(
        "call-1",
        { url: PAGE_URL },
        undefined,
        undefined,
        NO_CTX,
      ),
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
      assert.ok(error instanceof KagiTimeoutError);
      assert.equal(error.operation, "extract");
      assert.equal(error.timeoutMs, 10);
      assert.ok(error.message.includes("timed out"));
      return true;
    },
  );
});

test("kagi_extract caps oversized output at 50KB", async () => {
  const bigPage = Array.from(
    { length: 1000 },
    (_, i) => `Line ${String(i + 1).padStart(4, "0")} ${"x".repeat(50)}`,
  ).join("\n");
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
