/**
 * Whole-call failures — the errors thrown when an entire `kagi_search` or
 * `kagi_extract` call fails, as opposed to a per-page failure, which is
 * reported as ordinary content.
 *
 * Each class owns its own message wording, so the plain-language text the
 * agent reads and the structured fields a caller can branch on are built in
 * one place instead of being reassembled from a concatenated string.
 */

/** Plain-language wording for the HTTP statuses Kagi documents. */
const STATUS_MESSAGES: Record<number, string> = {
  400: "invalid request",
  401: "unauthorized — check that KAGI_API_KEY is valid",
  403: "forbidden — your IP address is not authorized for this key",
  429: "rate limited or API usage limit exhausted",
  500: "Kagi server error",
};

/**
 * The key is absent, so no Kagi call can be attempted at all. The message is
 * setup instructions rather than a diagnosis: the user, not the agent, has to
 * act on it.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "KAGI_API_KEY is not set. Export it in your shell environment " +
        "(for example, add 'export KAGI_API_KEY=...' to your shell profile). " +
        "Get a key at https://kagi.com/api/keys",
    );
    this.name = "MissingApiKeyError";
  }
}

/** The Kagi call exceeded the operation's timeout before a response arrived. */
export class KagiTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Kagi ${operation} timed out after ${timeoutMs / 1000}s`);
    this.name = "KagiTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The request never produced an HTTP response — DNS, TLS, socket, or any
 * other transport failure. The originating error is kept as `cause`.
 */
export class KagiRequestError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Kagi ${operation} request failed: ${reason}`, { cause });
    this.name = "KagiRequestError";
    this.operation = operation;
  }
}

/**
 * Kagi answered with a non-OK status. `status`, `trace`, and `detail` stay
 * addressable so a caller can distinguish a bad key from a rate limit without
 * matching on message prose; the message composes them for display.
 */
export class KagiApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly trace?: string;
  readonly detail?: string;

  constructor(
    operation: string,
    status: number,
    envelope: { trace?: string; detail?: string } = {},
    options?: { cause?: unknown },
  ) {
    const statusMessage = STATUS_MESSAGES[status] ?? `Kagi API error (HTTP ${status})`;
    const parts = [`Kagi ${operation} failed: ${statusMessage}`];
    if (envelope.detail) {parts.push(envelope.detail);}
    if (envelope.trace) {parts.push(`trace: ${envelope.trace}`);}

    super(parts.join(" — "), options);
    this.name = "KagiApiError";
    this.operation = operation;
    this.status = status;
    this.trace = envelope.trace;
    this.detail = envelope.detail;
  }
}
