import assert from "node:assert/strict";
import { test } from "node:test";
import { createKagiTools } from "../src/index.ts";
import { jsonResponse, NO_CTX, stubFetch, textOf } from "./helpers.ts";

function makeSearchTool(fetchImpl: typeof fetch, options: { apiKey?: string } = {}) {
  const apiKey = "apiKey" in options ? options.apiKey : "test-key";
  const [tool] = createKagiTools({ fetchImpl, getApiKey: () => apiKey });
  return tool;
}

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
      assert.ok(error instanceof Error);
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
          assert.ok(error instanceof Error);
          assert.ok(
            error.message.toLowerCase().includes(match.toLowerCase()),
            `"${error.message}" should mention ${match}`,
          );
          assert.ok(error.message.includes("It broke"), "should include the API error detail");
          assert.ok(error.message.includes(`trace-${status}`), "should include the trace id");
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
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("server error"));
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
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("Kagi search request failed"));
      assert.ok(error.message.includes("ENOTFOUND"));
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
      assert.ok(error instanceof Error);
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
