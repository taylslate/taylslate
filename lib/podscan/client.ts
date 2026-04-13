// ============================================================
// PODSCAN API CLIENT
// Base HTTP client for the Podscan REST API.
// Handles auth, rate limiting, retries, and GET/POST requests.
// ============================================================

import type { PodscanErrorDetail } from "./types";

const PODSCAN_BASE_URL = "https://podscan.fm/api/v1";

export class PodscanApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public rateLimitRemaining?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "PodscanApiError";
  }
}

export class PodscanClient {
  private apiKey: string;
  private rateLimitRemaining: number | null = null;
  private rateLimitLimit: number | null = null;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.PODSCAN_API_KEY;
    if (!key) {
      throw new Error("PODSCAN_API_KEY is not set");
    }
    this.apiKey = key;
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
    options?: { revalidate?: number; retries?: number }
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
    });
  }

  /**
   * POST request to the Podscan API.
   * Body is JSON-encoded.
   */
  async post<T>(
    path: string,
    body: Record<string, unknown>,
    options?: { revalidate?: number; retries?: number }
  ): Promise<T> {
    const url = `${PODSCAN_BASE_URL}${path}`;

    return this.execute<T>(url, {
      method: "POST",
      body: JSON.stringify(body),
      revalidate: options?.revalidate ?? 3600,
      retries: options?.retries ?? 2,
    });
  }

  private async execute<T>(
    url: string,
    options: {
      method: "GET" | "POST";
      body?: string;
      revalidate: number;
      retries: number;
    }
  ): Promise<T> {
    const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
      method: options.method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: options.revalidate },
    };

    if (options.body) {
      fetchOptions.body = options.body;
    }

    const res = await fetch(url, fetchOptions);

    // Track rate limit headers
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const limit = res.headers.get("X-RateLimit-Limit");
    if (remaining !== null) this.rateLimitRemaining = parseInt(remaining, 10);
    if (limit !== null) this.rateLimitLimit = parseInt(limit, 10);

    // Rate limited — retry with backoff
    if (res.status === 429 && options.retries > 0) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 7000;
      console.warn(`[podscan] Rate limited, retrying in ${waitMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.execute<T>(url, { ...options, retries: options.retries - 1 });
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

      throw new PodscanApiError(
        errorMessage,
        res.status,
        this.rateLimitRemaining ?? undefined,
        res.headers.get("Retry-After")
          ? parseInt(res.headers.get("Retry-After")!, 10)
          : undefined
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
