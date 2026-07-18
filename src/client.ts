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
