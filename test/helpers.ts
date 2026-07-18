import assert from "node:assert/strict";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export interface StubCall {
  url: string;
  init: RequestInit;
}

/**
 * A fetch stand-in that records calls and delegates to the given handler.
 * The single contained cast bridges to fetch's overloaded signature; tests
 * never construct real Requests.
 */
export function stubFetch(handler: (call: StubCall) => Response | Promise<Response>) {
  const calls: StubCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: StubCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Tool executions under test never touch the pi context. */
export const NO_CTX = undefined as unknown as ExtensionContext;

type ToolResult = Awaited<ReturnType<ToolDefinition["execute"]>>;

export function textOf(result: ToolResult): string {
  const part = result.content.find((content) => content.type === "text");
  if (!part || part.type !== "text") {
    assert.fail("expected a text content part in the tool result");
  }
  return part.text;
}
