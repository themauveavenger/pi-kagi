import assert from "node:assert/strict";
import { test } from "node:test";
import { createKagiTools } from "../src/index.ts";
import { KagiApiError, KagiRequestError, KagiTimeoutError, MissingApiKeyError } from "../src/errors.ts";
import SearchBudget from "../src/search-budget.ts";
import { jsonResponse, NO_CTX, stubFetch, textOf } from "./helpers.ts";

function makeSearchTool(fetchImpl: typeof fetch, options: { apiKey?: string } = {}) {
  const apiKey = "apiKey" in options ? options.apiKey : "test-key";
  const [tool] = createKagiTools({ fetchImpl, getApiKey: () => apiKey });
  return tool;
}

test("SearchBudget rejects limits that are not non-negative finite numbers", () => {
  for (const limit of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => new SearchBudget(limit), RangeError);
  }
});

test("SearchBudget accepts a zero limit", () => {
  const budget = new SearchBudget(0);

  assert.equal(budget.getLimit(), 0);
  assert.throws(() => budget.reserve(), /Kagi search budget exhausted.*0\/0/);
});

test("SearchBudget preserves usage during an active run and resets it after settlement", () => {
  const budget = new SearchBudget(2);

  budget.beginRun();
  budget.reserve();
  budget.beginRun();
  assert.equal(budget.getUsed(), 1, "a repeated start keeps the active run's usage");

  budget.settleRun();
  assert.equal(budget.getUsed(), 1, "settlement retains usage for status display");

  budget.beginRun();
  assert.equal(budget.getUsed(), 0, "a new run receives a fresh budget");
});

test("kagi_search posts the query and renders a numbered markdown list", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "trace-1", ms: 314, node: "us-east4" },
      data: {
        search: [
          {
            url: "https://example.com/alpha",
            title: "Alpha",
            snippet: "First result",
            time: "2024-11-29T03:54:26Z",
          },
          { url: "https://example.com/beta", title: "Beta", snippet: "Second result" },
        ],
      },
    }),
  );

  const tool = makeSearchTool(fetchImpl);
  const result = await tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call?.url, "https://kagi.com/api/v1/search");
  assert.equal(call?.init.method, "POST");
  const headers = call?.init.headers as Record<string, string>;
  assert.equal(headers["authorization"], "Bearer test-key");
  assert.deepEqual(JSON.parse(String(call?.init.body)), {
    query: "steve jobs",
    workflow: "search",
    format: "json",
  });

  const text = textOf(result);
  assert.ok(text.includes("1. [Alpha](https://example.com/alpha) — 2024-11-29"));
  assert.ok(text.includes("   First result"));
  assert.ok(text.includes("2. [Beta](https://example.com/beta)"));
});

test("kagi_search throws setup instructions when KAGI_API_KEY is missing", async () => {
  const { calls, fetchImpl } = stubFetch(() => {
    throw new Error("fetch should not be called");
  });

  const tool = makeSearchTool(fetchImpl, { apiKey: undefined });
  await assert.rejects(
    () => tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof MissingApiKeyError);
      assert.ok(error.message.includes("KAGI_API_KEY"));
      assert.ok(error.message.includes("https://kagi.com/api/keys"));
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test("kagi_search maps HTTP errors to plain-language messages with trace and detail", async (t) => {
  const cases = [
    { status: 400, match: "invalid request" },
    { status: 401, match: "KAGI_API_KEY" },
    { status: 403, match: "not authorized" },
    { status: 429, match: "rate limit" },
    { status: 500, match: "server error" },
  ];

  for (const { status, match } of cases) {
    await t.test(`HTTP ${status}`, async () => {
      const { fetchImpl } = stubFetch(() =>
        jsonResponse(
          {
            meta: { trace: `trace-${status}` },
            data: null,
            error: [
              {
                code: "boom",
                url: "https://help.kagi.com/api/errors#boom",
                message: "It broke",
                location: null,
              },
            ],
          },
          status,
        ),
      );

      const tool = makeSearchTool(fetchImpl);
      await assert.rejects(
        () => tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX),
        (error: unknown) => {
          assert.ok(error instanceof KagiApiError);
          assert.equal(error.status, status);
          assert.equal(error.operation, "search");
          assert.equal(error.trace, `trace-${status}`);
          assert.equal(error.detail, "It broke");
          assert.ok(
            error.message.toLowerCase().includes(match.toLowerCase()),
            `"${error.message}" should mention ${match}`,
          );
          return true;
        },
      );
    });
  }
});

test("kagi_search tolerates a non-JSON error body", async () => {
  const { fetchImpl } = stubFetch(() => new Response("<html>bad gateway</html>", { status: 500 }));

  const tool = makeSearchTool(fetchImpl);
  await assert.rejects(
    () => tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof KagiApiError);
      assert.equal(error.status, 500);
      assert.equal(error.trace, undefined);
      assert.ok(error.message.includes("server error"));
      assert.ok(error.cause instanceof Error, "should keep the body-parse failure as the cause for debugging");
      return true;
    },
  );
});

test("kagi_search ignores a trace on a body that is not a real error envelope", async () => {
  // A body with `meta.trace` but no `error` array is not an error envelope
  // per the OpenAPI schema (which requires `meta` and a non-empty `error`).
  // The trace must not be trusted; fall back to the status-only message.
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({ meta: { trace: "should-not-leak" }, data: { search: [] } }, 500),
  );

  const tool = makeSearchTool(fetchImpl);
  await assert.rejects(
    () => tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof KagiApiError);
      assert.equal(error.trace, undefined, "must not adopt a trace from a non-envelope body");
      assert.ok(error.message.includes("server error"), "should mention the status");
      assert.ok(!error.message.includes("should-not-leak"), "must not adopt a trace from a non-envelope body");
      return true;
    },
  );
});

test("kagi_search wraps network failures in plain language", async () => {
  const { fetchImpl } = stubFetch(() => Promise.reject(new TypeError("fetch failed: getaddrinfo ENOTFOUND kagi.com")));

  const tool = makeSearchTool(fetchImpl);
  await assert.rejects(
    () => tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof KagiRequestError);
      assert.equal(error.operation, "search");
      assert.ok(error.message.includes("Kagi search request failed"));
      assert.ok(error.message.includes("ENOTFOUND"));
      assert.ok(error.cause instanceof TypeError, "should keep the transport failure as the cause");
      return true;
    },
  );
});

test("kagi_search times out with a plain-language message", async () => {
  const { fetchImpl } = stubFetch(
    ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );

  const [tool] = createKagiTools({ fetchImpl, getApiKey: () => "test-key", searchTimeoutMs: 10 });
  await assert.rejects(
    () => tool.execute("call-1", { query: "steve jobs" }, undefined, undefined, NO_CTX),
    (error: unknown) => {
      assert.ok(error instanceof KagiTimeoutError);
      assert.equal(error.timeoutMs, 10);
      assert.ok(error.message.includes("timed out"));
      return true;
    },
  );
});

test("kagi_search propagates caller cancellation", async () => {
  const controller = new AbortController();
  const { fetchImpl } = stubFetch(
    ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );

  const tool = makeSearchTool(fetchImpl);
  const pending = tool.execute("call-1", { query: "steve jobs" }, controller.signal, undefined, NO_CTX);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof DOMException && error.name === "AbortError");
    return true;
  });
});

test("kagi_search caps snippets at 240 characters with an ellipsis", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "t" },
      data: { search: [{ url: "https://example.com/a", title: "Alpha", snippet: "a".repeat(300) }] },
    }),
  );

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);

  assert.ok(textOf(result).includes(`   ${"a".repeat(239)}…`));
});

test("kagi_search flattens multiline snippets onto one line", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "t" },
      data: { search: [{ url: "https://example.com/a", title: "Alpha", snippet: "one\ntwo   three" }] },
    }),
  );

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);

  assert.ok(textOf(result).includes("   one two three"));
});

test("kagi_search never renders props or proxy image URLs", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "t" },
      data: {
        search: [
          {
            url: "https://example.com/a",
            title: "Alpha",
            snippet: "A result",
            image: { url: "https://p.kagi.com/proxy/th?c=secretproxytoken" },
            props: { language_probability: 0.98, group_id: "secretgroup" },
          },
        ],
      },
    }),
  );

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);
  const text = textOf(result);

  assert.ok(!text.includes("secretproxytoken"));
  assert.ok(!text.includes("language_probability"));
  assert.ok(!text.includes("secretgroup"));
});

test("kagi_search reports when nothing was found", async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse({ meta: { trace: "t" }, data: {} }));

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);

  assert.equal(textOf(result), "No results found.");
});

test("kagi_search renders non-web arrays as labeled sections after web results", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "t" },
      data: {
        news: [{ url: "https://news.example.com/x", title: "News item", snippet: "Breaking" }],
        search: [{ url: "https://example.com/a", title: "Web item", snippet: "Web snippet" }],
        direct_answer: [{ url: "", title: "42", snippet: "The answer to everything" }],
      },
    }),
  );

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);
  const text = textOf(result);

  assert.ok(text.indexOf("Web item") < text.indexOf("## News"), "web results come before sections");
  assert.ok(text.indexOf("## News") < text.indexOf("## Direct answer"), "sections keep API order");
  assert.ok(text.includes("1. [News item](https://news.example.com/x)"));
});

function searchResponseOf(count: number) {
  return {
    meta: { trace: "t" },
    data: {
      search: Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/r${i + 1}`,
        title: `Result ${i + 1}`,
        snippet: `Snippet ${i + 1}`,
      })),
    },
  };
}

test("kagi_search shows the first 10 results by default with a position footer", async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(23)));

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);
  const text = textOf(result);

  assert.ok(text.includes("1. [Result 1](https://example.com/r1)"));
  assert.ok(text.includes("10. [Result 10](https://example.com/r10)"));
  assert.ok(!text.includes("Result 11"), "results past the default limit stay hidden");
  assert.ok(text.includes("Showing results 1–10 of 23"));
  assert.ok(text.includes("offset: 11"), "footer points at the next offset");
});

test("kagi_search pages with limit and offset using absolute numbering", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(23)));

  const result = await makeSearchTool(fetchImpl).execute(
    "call-1",
    { query: "q", limit: 5, offset: 11 },
    undefined,
    undefined,
    NO_CTX,
  );
  const text = textOf(result);

  assert.ok(!text.includes("Result 10\n"), "earlier results stay hidden");
  assert.ok(text.includes("11. [Result 11](https://example.com/r11)"));
  assert.ok(text.includes("15. [Result 15](https://example.com/r15)"));
  assert.ok(!text.includes("Result 16"), "results past the slice stay hidden");
  assert.ok(text.includes("Showing results 11–15 of 23"));
  assert.ok(text.includes("offset: 16"));

  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    query: "q",
    workflow: "search",
    format: "json",
  });
});

test("kagi_search explains when the offset is beyond the results", async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(23)));

  const result = await makeSearchTool(fetchImpl).execute(
    "call-1",
    { query: "q", offset: 50 },
    undefined,
    undefined,
    NO_CTX,
  );
  const text = textOf(result);

  assert.ok(text.includes("offset: 50"));
  assert.ok(text.includes("23 results"));
});

test("kagi_search serves identical repeat searches from cache without a new fetch", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(23)));
  const tool = makeSearchTool(fetchImpl);

  const first = await tool.execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);
  const second = await tool.execute("call-2", { query: "q" }, undefined, undefined, NO_CTX);

  assert.equal(calls.length, 1, "the second identical search must not hit the API");
  assert.ok(!textOf(first).includes("(from cache)"));
  assert.ok(textOf(second).includes("(from cache)"));
});

test("kagi_search serves paging of a cached query without a new fetch", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(23)));
  const tool = makeSearchTool(fetchImpl);

  await tool.execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);
  const paged = await tool.execute("call-2", { query: "q", offset: 11, limit: 5 }, undefined, undefined, NO_CTX);

  assert.equal(calls.length, 1);
  const text = textOf(paged);
  assert.ok(text.includes("11. [Result 11](https://example.com/r11)"));
  assert.ok(text.includes("(from cache)"));
});

test("kagi_search fetches once per distinct query", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(3)));
  const tool = makeSearchTool(fetchImpl);

  await tool.execute("call-1", { query: "q1" }, undefined, undefined, NO_CTX);
  const second = await tool.execute("call-2", { query: "q2" }, undefined, undefined, NO_CTX);

  assert.equal(calls.length, 2);
  assert.ok(!textOf(second).includes("(from cache)"));
});

test("kagi_search evicts the oldest cached query beyond 50 entries", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(1)));
  const tool = makeSearchTool(fetchImpl);

  for (let i = 1; i <= 51; i++) {
    await tool.execute(`call-${i}`, { query: `q${i}` }, undefined, undefined, NO_CTX);
  }
  assert.equal(calls.length, 51);

  const evicted = await tool.execute("call-52", { query: "q1" }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 52, "q1 was evicted by the 51st distinct query");
  assert.ok(!textOf(evicted).includes("(from cache)"));

  const retained = await tool.execute("call-53", { query: "q51" }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 52, "q51 survived eviction and stays cached");
  assert.ok(textOf(retained).includes("(from cache)"));
});

test("kagi_search caps oversized output at 50KB", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "t" },
      data: {
        search: Array.from({ length: 25 }, (_, i) => ({
          url: `https://example.com/r${i + 1}`,
          title: `Result ${i + 1} ${"t".repeat(3000)}`,
        })),
      },
    }),
  );

  const result = await makeSearchTool(fetchImpl).execute(
    "call-1",
    { query: "q", limit: 25 },
    undefined,
    undefined,
    NO_CTX,
  );
  const text = textOf(result);

  assert.ok(new TextEncoder().encode(text).byteLength <= 50 * 1024, "output stays within 50KB");
  assert.ok(text.includes("[Output capped at 50KB"));
});

test("kagi_search allows only two paid searches during one agent run and resets after settlement", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(searchResponseOf(1)));
  const budget = new SearchBudget(2);
  const [tool] = createKagiTools({ fetchImpl, getApiKey: () => "test-key" }, { searchBudget: budget });

  budget.beginRun();
  await tool.execute("call-1", { query: "first" }, undefined, undefined, NO_CTX);
  await tool.execute("call-2", { query: "second" }, undefined, undefined, NO_CTX);
  await assert.rejects(
    () => tool.execute("call-3", { query: "third" }, undefined, undefined, NO_CTX),
    /Kagi search budget exhausted.*2\/2/,
  );
  assert.equal(calls.length, 2, "the blocked search never reaches Kagi");

  budget.settleRun();
  budget.beginRun();
  await tool.execute("call-4", { query: "third" }, undefined, undefined, NO_CTX);
  assert.equal(calls.length, 3, "a new agent run receives a fresh search budget");
});

test("kagi_search declares limit and offset bounds in its parameter schema", () => {
  const tool = makeSearchTool(stubFetch(() => jsonResponse({})).fetchImpl);
  const { limit, offset } = tool.parameters.properties;

  assert.ok("maximum" in limit && limit.maximum === 25);
  assert.ok("minimum" in limit && limit.minimum === 1);
  assert.ok("minimum" in offset && offset.minimum === 1);
});

test("kagi_search renders items without a URL as plain text, not empty links", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse({
      meta: { trace: "t" },
      data: {
        direct_answer: [{ url: "", title: "42", snippet: "The answer to everything" }],
      },
    }),
  );

  const result = await makeSearchTool(fetchImpl).execute("call-1", { query: "q" }, undefined, undefined, NO_CTX);
  const text = textOf(result);

  assert.ok(text.includes("1. 42"));
  assert.ok(!text.includes("[42]()"));
});
