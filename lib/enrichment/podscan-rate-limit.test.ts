import { afterEach, describe, expect, it, vi } from "vitest";
import { PodscanClient, PodscanError } from "./podscan";

function rateLimited(retryAfter: string, remaining = "0"): Response {
  return new Response("{}", {
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      "Retry-After": retryAfter,
      "X-RateLimit-Remaining": remaining,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("discovery Podscan client rate limit", () => {
  it("throws on a daily-limit 429 without sleeping", async () => {
    const slept: number[] = [];
    const fetchMock = vi.fn(async () => rateLimited("23130", "0"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new PodscanClient("test-key", async (ms) => {
      slept.push(ms);
    });

    const err = await client.getPodcastDemographics("pd_1").then(
      () => null,
      (error: unknown) => error
    );

    expect(err).toBeInstanceOf(PodscanError);
    expect(err).toMatchObject({ status: 429, retryAfter: 23130, rateLimitRemaining: 0 });
    expect(slept).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a timeout from a hung demographics fetch", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        const abort = () => {
          reject(signal.reason ?? new DOMException("timeout", "TimeoutError"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    const client = new PodscanClient("test-key", undefined, 30);

    const err = await Promise.race([
      client.getPodcastDemographics("pd_1").then(
        () => "resolved",
        (error: unknown) => error
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(err).not.toBe("hung");
    expect(err).not.toBeNull();
    expect(err).toBeInstanceOf(PodscanError);
    expect((err as PodscanError).message).toMatch(/timeout/i);
    expect((err as PodscanError).status).toBeUndefined();
  });
});
