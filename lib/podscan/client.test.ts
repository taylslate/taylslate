import { afterEach, describe, expect, it, vi } from "vitest";
import { PodscanApiError, PodscanClient } from "./client";

function rateLimited(retryAfter: string | null, remaining = "0"): Response {
  const headers = new Headers();
  if (retryAfter != null) headers.set("Retry-After", retryAfter);
  headers.set("X-RateLimit-Remaining", remaining);
  return new Response("{}", {
    status: 429,
    statusText: "Too Many Requests",
    headers,
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PodscanClient 429 and timeout", () => {
  it("throws immediately on a 429 with Retry-After 23130 and does not sleep", async () => {
    const slept: number[] = [];
    const fetchMock = vi.fn(async () => rateLimited("23130", "0"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new PodscanClient("test-key", async (ms) => {
      slept.push(ms);
    });

    const err = await client.get("/podcasts/pd_1").then(
      () => null,
      (error: unknown) => error
    );

    expect(err).toBeInstanceOf(PodscanApiError);
    expect(err).toMatchObject({
      status: 429,
      retryAfter: 23130,
      rateLimitRemaining: 0,
    });
    expect(slept).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when Retry-After is 2 seconds", async () => {
    const slept: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimited("2", "0"))
      .mockResolvedValueOnce(ok({ podcasts: [{ podcast_id: "pd_ok" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new PodscanClient("test-key", async (ms) => {
      slept.push(ms);
    });

    const result = await client.get<{ podcasts: Array<{ podcast_id: string }> }>(
      "/podcasts/search"
    );

    expect(slept).toEqual([2000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.podcasts[0]?.podcast_id).toBe("pd_ok");
  });

  it("does not sleep more than 10s in total for one call", async () => {
    const slept: number[] = [];
    const fetchMock = vi.fn(async () => rateLimited("6", "3"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new PodscanClient("test-key", async (ms) => {
      slept.push(ms);
    });

    const err = await client.get("/podcasts/search").then(
      () => null,
      (error: unknown) => error
    );

    expect(err).toBeInstanceOf(PodscanApiError);
    expect(err).toMatchObject({ status: 429 });
    expect(slept).toEqual([6000]);
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a status-less timeout when the fetch does not finish", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        const abort = () => {
          const reason = signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new DOMException("The operation was aborted due to timeout", "TimeoutError")
          );
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    const client = new PodscanClient("test-key", async () => {
      throw new Error("sleep should not run on a timeout");
    });

    const err = await Promise.race([
      client.get("/podcasts/search", undefined, { timeoutMs: 30 }).then(
        () => "resolved",
        (error: unknown) => error
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(err).not.toBe("hung");
    expect(err).toBeInstanceOf(PodscanApiError);
    expect(err).toMatchObject({ message: "Podscan API timeout" });
    expect((err as PodscanApiError).status).toBeUndefined();
  });
});
