import { match, P } from "ts-pattern";
import { KagiApiError, KagiRequestError, KagiTimeoutError, MissingApiKeyError } from "./errors.ts";

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
      throw new MissingApiKeyError();
    }
    return apiKey;
  }

  async function post(route: string, operation: string, body: unknown, timeoutMs: number, signal?: AbortSignal) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) {
      signals.push(signal);
    }

    // Resolved before the try: a missing key is a configuration failure, not
    // a transport one, and must not be wrapped as a failed request.
    const apiKey = requireApiKey();

    let response: Response;
    try {
      response = await options.fetchImpl(`${BASE_URL}${route}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
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

/**
 * The error response shape from the Kagi API, per the OpenAPI `errorEnvelope`
 * schema: `meta` and a non-empty `error` array are required. `meta.trace` is
 * optional debug info; the first `errorDetail` carries a required `code` and a
 * nullable `message`.
 */
interface ErrorEnvelope {
  meta: { trace?: unknown };
  error: { code?: unknown; message?: unknown }[];
}

/**
 * Type guard that validates the required structure of a Kagi error envelope:
 * an object with a `meta` object and a non-empty `error` array whose every
 * element is a non-null object. Narrowing to `ErrorEnvelope` is then honest —
 * the fields the type names (including every array element) are actually
 * present, not just the first element we happen to read.
 */
function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const v = value as Record<string, unknown>;

  if (typeof v.meta !== "object" || v.meta === null) {
    return false;
  }

  if (!Array.isArray(v.error) || v.error.length === 0) {
    return false;
  }

  return v.error.every((entry) => typeof entry === "object" && entry !== null);
}

/**
 * Extract the human-readable parts of a validated error envelope — Kagi's
 * trace id and the first error detail (preferring `message`, falling back to
 * `code`) — or `null` when the body isn't a well-formed envelope, so the
 * caller can fall back to a status-only message.
 */
function describeErrorEnvelope(body: unknown): { trace?: string; detail?: string } | null {
  if (!isErrorEnvelope(body)) {
    return null;
  }

  const trace = typeof body.meta.trace === "string" ? body.meta.trace : undefined;
  const first = body.error[0];
  const detail = match(first)
    .with({ message: P.string }, (entry) => entry.message)
    .with({ code: P.string }, (entry) => entry.code)
    .otherwise(() => undefined);

  return { trace, detail };
}

function normalizeFetchError(cause: unknown, operation: string, timeoutMs: number): Error {
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
      () => new KagiTimeoutError(operation, timeoutMs),
    )
    .otherwise(() => new KagiRequestError(operation, cause));
}

async function toApiError(response: Response, operation: string): Promise<Error> {
  let envelope: { trace?: string; detail?: string } = {};
  // Why the body could not be read, kept for the returned error's `cause`.
  // The fall-through to a status-only message is deliberate, but discarding
  // the reason would leave nothing to debug when the body was unexpected.
  let bodyFailure: unknown;

  try {
    const body: unknown = await response.json();
    envelope = describeErrorEnvelope(body) ?? {};
  } catch (cause) {
    bodyFailure = cause;
  }

  return new KagiApiError(
    operation,
    response.status,
    envelope,
    bodyFailure === undefined ? undefined : { cause: bodyFailure },
  );
}
