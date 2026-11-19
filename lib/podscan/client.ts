// ============================================================
// PODSCAN API CLIENT
// Base HTTP client for the Podscan REST API.
// Handles auth, rate limiting, retries, and GET/POST requests.
// ============================================================

import type { PodscanErrorDetail } from "./types";

const PODSCAN_BASE_URL = "https://podscan.fm/api/v1";

/** Wait used when a 429 has no Retry-After header. */
export const PODSCAN_429_DEFAULT_WAIT_MS = 7_000;
/** One call never sleeps longer than this, across every 429 retry. */
export const PODSCAN_429_MAX_SLEEP_MS = 10_000;
/** Per-request fetch timeout. Callers can override it on get/post. */
export const PODSCAN_FETCH_TIMEOUT_MS = 15_000;

export class PodscanApiError extends Error {
  constructor(
    message: string,
    /** Omitted on a timeout. HTTP failures still carry the status. */
    public status?: number,
    public rateLimitRemaining?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "PodscanApiError";
  }
}

export function podscanSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry-After as delta-seconds. An HTTP-date is converted to seconds from now.
 * Missing or unparseable headers return null (the caller waits the 7s default).
 */
export function parseRetryAfterSeconds(header: string | null, nowMs = Date.now()): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds : null;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, (dateMs - nowMs) / 1000);
}

export function isPodscanTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  return err instanceof Error && /aborted due to timeout/i.test(err.message);
}

export function resolvePodscanTimeoutMs(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return PODSCAN_FETCH_TIMEOUT_MS;
  return value;
}

export type Podscan429Decision =
  | { action: "retry"; waitMs: number }
  | { action: "throw"; retryAfter?: number };

/**
 * Retry a 429 only when the wait is short.
 * A missing Retry-After keeps the 7s wait. Retry-After over 10 seconds does
 * not sleep. That includes a daily limit: X-RateLimit-Remaining 0 with
 * Retry-After over 10s. sleptMs is time already spent waiting on this call.
 * The total sleep for one call never exceeds 10s.
 */
export function decidePodscan429(input: {
  retryAfterHeader: string | null;
  remainingHeader: string | null;
  retries: number;
  sleptMs: number;
  nowMs?: number;
}): Podscan429Decision {
  const retryAfter = parseRetryAfterSeconds(input.retryAfterHeader, input.nowMs);
  const retryAfterRounded = retryAfter == null ? undefined : Math.round(retryAfter);

  if (input.retries <= 0) {
    return { action: "throw", retryAfter: retryAfterRounded };
  }

  const remaining = parseRemaining(input.remainingHeader);
  const overTenSeconds = retryAfter != null && retryAfter > 10;
  const dailyLimit = remaining === 0 && overTenSeconds;
  if (overTenSeconds || dailyLimit) {
    return { action: "throw", retryAfter: retryAfterRounded };
  }

  const waitMs =
    retryAfter == null ? PODSCAN_429_DEFAULT_WAIT_MS : Math.max(0, retryAfter) * 1000;
  if (waitMs > PODSCAN_429_MAX_SLEEP_MS || input.sleptMs + waitMs > PODSCAN_429_MAX_SLEEP_MS) {
    return { action: "throw", retryAfter: retryAfterRounded };
  }
  return { action: "retry", waitMs };
}

function parseRemaining(header: string | null): number | null {
  if (header == null || header.trim() === "") return null;
  const value = Number(header);
  return Number.isFinite(value) ? value : null;
}

export class PodscanClient {
  private apiKey: string;
  private rateLimitRemaining: number | null = null;
  private rateLimitLimit: number | null = null;

  private readonly sleep: (ms: number) => Promise<void>;

  constructor(apiKey?: string, sleep?: (ms: number) => Promise<void>) {
    const key = apiKey ?? process.env.PODSCAN_API_KEY;
    if (!key) {
      throw new Error("PODSCAN_API_KEY is not set");
    }
    this.apiKey = key;
    this.sleep = sleep ?? podscanSleep;
  }

  /** Current rate limit remaining (updated after each request) */
  getRateLimitRemaining(): number | null {
    return this.rateLimitRemaining;
  }

  /** Rate limit ceiling (updated after each request) */
  getRateLimitLimit(): number | null {
    return this.rateLimitLimit;
  }

  /**
   * GET request to the Podscan API.
   * Params with undefined values are omitted from the query string.
   */
  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { revalidate?: number; retries?: number; timeoutMs?: number }
  ): Promise<T> {
    const url = new URL(`${PODSCAN_BASE_URL}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return this.execute<T>(url.toString(), {
      method: "GET",
      revalidate: options?.revalidate ?? 3600,
      retries: options?.retries ?? 2,
      timeoutMs: resolvePodscanTimeoutMs(options?.timeoutMs),
      sleptMs: 0,
    });
  }

  /**
   * POST request to the Podscan API.
   * Body is JSON-encoded.
   */
  async post<T>(
    path: string,
    body: Record<string, unknown>,
    options?: { revalidate?: number; retries?: number; timeoutMs?: number }
  ): Promise<T> {
    const url = `${PODSCAN_BASE_URL}${path}`;

    return this.execute<T>(url, {
      method: "POST",
      body: JSON.stringify(body),
      revalidate: options?.revalidate ?? 3600,
      retries: options?.retries ?? 2,
      timeoutMs: resolvePodscanTimeoutMs(options?.timeoutMs),
      sleptMs: 0,
    });
  }

  private async execute<T>(
    url: string,
    options: {
      method: "GET" | "POST";
      body?: string;
      revalidate: number;
      retries: number;
      timeoutMs: number;
      sleptMs: number;
    }
  ): Promise<T> {
    const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
      method: options.method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: options.revalidate },
      signal: AbortSignal.timeout(options.timeoutMs),
    };

    if (options.body) {
      fetchOptions.body = options.body;
    }

    let res: Response;
    try {
      res = await fetch(url, fetchOptions);
    } catch (err) {
      if (isPodscanTimeout(err)) {
        throw new PodscanApiError("Podscan API timeout");
      }
      throw err;
    }

    // Track rate limit headers
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const limit = res.headers.get("X-RateLimit-Limit");
    if (remaining !== null) this.rateLimitRemaining = parseInt(remaining, 10);
    if (limit !== null) this.rateLimitLimit = parseInt(limit, 10);

    // A long Retry-After throws. A short one sleeps, then retries.
    if (res.status === 429) {
      const decision = decidePodscan429({
        retryAfterHeader: res.headers.get("Retry-After"),
        remainingHeader: remaining,
        retries: options.retries,
        sleptMs: options.sleptMs,
      });
      if (decision.action === "retry") {
        console.warn(`[podscan] Rate limited, retrying in ${decision.waitMs}ms...`);
        await this.sleep(decision.waitMs);
        return this.execute<T>(url, {
          ...options,
          retries: options.retries - 1,
          sleptMs: options.sleptMs + decision.waitMs,
        });
      }
    }

    if (!res.ok) {
      let errorMessage = `Podscan API error: ${res.status} ${res.statusText}`;
      try {
        const errorBody = (await res.json()) as PodscanErrorDetail;
        if (errorBody.message) {
          errorMessage = `Podscan API error: ${errorBody.message}`;
        }
      } catch {
        // Body wasn't JSON, use default message
      }

      const retryAfter = parseRetryAfterSeconds(res.headers.get("Retry-After"));
      throw new PodscanApiError(
        errorMessage,
        res.status,
        this.rateLimitRemaining ?? undefined,
        retryAfter == null ? undefined : Math.round(retryAfter)
      );
    }

    return res.json() as Promise<T>;
  }
}

// ---- Singleton ----

let _client: PodscanClient | null = null;

export function getPodscanClient(): PodscanClient {
  if (!_client) {
    _client = new PodscanClient();
  }
  return _client;
}

export function getPodscanClientSafe(): PodscanClient | null {
  if (!process.env.PODSCAN_API_KEY) {
    console.info("[podscan] PODSCAN_API_KEY not configured — client unavailable");
    return null;
  }
  return getPodscanClient();
}
