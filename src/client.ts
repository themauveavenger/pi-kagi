import { match, P } from "ts-pattern";

export interface KagiClientOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
  extractTimeoutMs?: number;
}

export interface SearchResultItem {
  url: string;
  title: string;
  snippet?: string;
  time?: string;
}

export interface SearchResponse {
  meta?: {
    trace?: string;
    ms?: number;
    node?: string;
  };
  data?: Record<string, SearchResultItem[] | undefined>;
}

export interface PageOutput {
  url: string;
  markdown?: string;
  error?: string;
}

export interface ExtractResponse {
  meta?: {
    trace?: string;
    ms?: number;
    node?: string;
  };
  data?: PageOutput[];
}

export interface KagiClient {
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
  extract(url: string, signal?: AbortSignal): Promise<PageOutput>;
}

const BASE_URL = "https://kagi.com/api/v1";
const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_EXTRACT_TIMEOUT_MS = 30_000;

export function createKagiClient(options: KagiClientOptions): KagiClient {
  function requireApiKey(): string {
    const apiKey = options.getApiKey();
    if (!apiKey) {
      throw new Error(
        "KAGI_API_KEY is not set. Export it in your shell environment " +
          "(for example, add 'export KAGI_API_KEY=...' to your shell profile). " +
          "Get a key at https://kagi.com/api/keys",
      );
    }
    return apiKey;
  }

  async function post(route: string, operation: string, body: unknown, timeoutMs: number, signal?: AbortSignal) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) {
      signals.push(signal);
    }

    let response: Response;
    try {
      response = await options.fetchImpl(`${BASE_URL}${route}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${requireApiKey()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (cause) {
      throw normalizeFetchError(cause, operation, timeoutMs);
    }

    if (!response.ok) {
      throw await toApiError(response, operation);
    }
    return response;
  }

  return {
    async search(query, signal) {
      const response = await post(
        "/search",
        "search",
        { query, workflow: "search", format: "json" },
        options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );
      return (await response.json()) as SearchResponse;
    },

    async extract(url, signal) {
      const response = await post(
        "/extract",
        "extract",
        { pages: [{ url }], format: "json" },
        options.extractTimeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS,
        signal,
      );
      const body = (await response.json()) as ExtractResponse;
      return body.data?.[0] ?? { url };
    },
  };
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "invalid request",
  401: "unauthorized — check that KAGI_API_KEY is valid",
  403: "forbidden — your IP address is not authorized for this key",
  429: "rate limited or API usage limit exhausted",
  500: "Kagi server error",
};

/**
 * The error response shape from the Kagi API, per the OpenAPI `errorEnvelope`
 * schema: `meta` and a non-empty `error` array are required. `meta.trace` is
 * optional debug info; the first `errorDetail` carries a required `code` and a
 * nullable `message`.
 */
interface ErrorEnvelope {
  meta: { trace?: unknown };
  error: Array<{ code?: unknown; message?: unknown }>;
}

/**
 * Type guard that validates the required structure of a Kagi error envelope:
 * an object with a `meta` object and a non-empty `error` array whose every
 * element is a non-null object. Narrowing to `ErrorEnvelope` is then honest —
 * the fields the type names (including every array element) are actually
 * present, not just the first element we happen to read.
 */
function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.meta !== "object" || v.meta === null) return false;
  if (!Array.isArray(v.error) || v.error.length === 0) return false;
  return v.error.every((entry) => typeof entry === "object" && entry !== null);
}

/**
 * Extract the human-readable parts of a validated error envelope — Kagi's
 * trace id and the first error detail (preferring `message`, falling back to
 * `code`) — or `null` when the body isn't a well-formed envelope, so the
 * caller can fall back to a status-only message.
 */
function describeErrorEnvelope(body: unknown): { trace?: string; detail?: string } | null {
  if (!isErrorEnvelope(body)) return null;

  const trace = typeof body.meta.trace === "string" ? body.meta.trace : undefined;
  const first = body.error[0];
  const detail = match(first)
    .with({ message: P.string }, (entry) => entry.message)
    .with({ code: P.string }, (entry) => entry.code)
    .otherwise(() => undefined);

  return { trace, detail };
}

function normalizeFetchError(cause: unknown, operation: string, timeoutMs: number): Error {
  const message = (error: Error) => `Kagi ${operation} request failed: ${error.message}`;

  return match(cause)
    .with(
      P.instanceOf(DOMException),
      (error) => error.name === "AbortError",
      // Caller cancellation — propagate as-is so pi sees a normal abort.
      (error) => error,
    )
    .with(
      P.instanceOf(DOMException),
      (error) => error.name === "TimeoutError",
      () => new Error(`Kagi ${operation} timed out after ${timeoutMs / 1000}s`),
    )
    .with(P.instanceOf(DOMException), (error) => new Error(message(error), { cause }))
    .with(P.instanceOf(Error), (error) => new Error(message(error), { cause }))
    .otherwise(() => new Error(`Kagi ${operation} request failed: ${String(cause)}`, { cause }));
}

async function toApiError(response: Response, operation: string): Promise<Error> {
  let trace: string | undefined;
  let detail: string | undefined;

  try {
    const body: unknown = await response.json();
    const described = describeErrorEnvelope(body);
    if (described) {
      trace = described.trace;
      detail = described.detail;
    }
  } catch {
    // Error body wasn't JSON — fall through to the status-only message.
  }

  const statusMessage = STATUS_MESSAGES[response.status] ?? `Kagi API error (HTTP ${response.status})`;
  const parts = [`Kagi ${operation} failed: ${statusMessage}`];
  if (detail) {
    parts.push(detail);
  }
  if (trace) {
    parts.push(`trace: ${trace}`);
  }
  return new Error(parts.join(" — "));
}
