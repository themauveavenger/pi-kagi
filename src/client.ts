export interface KagiClientOptions {
  fetchImpl: typeof fetch;
  getApiKey: () => string | undefined;
  searchTimeoutMs?: number;
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

export interface KagiClient {
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
}

const BASE_URL = "https://kagi.com/api/v1";
const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;

export function createKagiClient(options: KagiClientOptions): KagiClient {
  return {
    async search(query, signal) {
      const apiKey = options.getApiKey();
      if (!apiKey) {
        throw new Error(
          "KAGI_API_KEY is not set. Export it in your shell environment " +
            "(for example, add 'export KAGI_API_KEY=...' to your shell profile). " +
            "Get a key at https://kagi.com/api/keys",
        );
      }

      const signals = [AbortSignal.timeout(options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS)];
      if (signal) {
        signals.push(signal);
      }

      let response: Response;
      try {
        response = await options.fetchImpl(`${BASE_URL}/search`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ query, workflow: "search", format: "json" }),
          signal: AbortSignal.any(signals),
        });
      } catch (cause) {
        throw normalizeFetchError(cause, "search", options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS);
      }

      if (!response.ok) {
        throw await toApiError(response, "search");
      }

      return (await response.json()) as SearchResponse;
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

interface ErrorEnvelope {
  meta?: { trace?: unknown };
  error?: Array<{ code?: unknown; message?: unknown }>;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return typeof value === "object" && value !== null;
}

function normalizeFetchError(cause: unknown, operation: string, timeoutMs: number): Error {
  if (cause instanceof DOMException) {
    if (cause.name === "AbortError") {
      // Caller cancellation — propagate as-is so pi sees a normal abort.
      return cause;
    }
    if (cause.name === "TimeoutError") {
      return new Error(`Kagi ${operation} timed out after ${timeoutMs / 1000}s`);
    }
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Kagi ${operation} request failed: ${message}`, { cause });
}

async function toApiError(response: Response, operation: string): Promise<Error> {
  let trace: string | undefined;
  let detail: string | undefined;

  try {
    const body: unknown = await response.json();
    if (isErrorEnvelope(body)) {
      if (typeof body.meta?.trace === "string") {
        trace = body.meta.trace;
      }
      const first = body.error?.[0];
      if (typeof first?.message === "string") {
        detail = first.message;
      } else if (typeof first?.code === "string") {
        detail = first.code;
      }
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
