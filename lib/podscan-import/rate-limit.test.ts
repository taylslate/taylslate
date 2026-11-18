import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLE_CONCURRENCY,
  APPLE_PER_MINUTE,
  HostLimiter,
  PODSCAN_CONCURRENCY,
  PODSCAN_PER_MINUTE,
  PodscanGate,
  PodscanStop,
  TRANSIENT_ATTEMPTS,
  appleBackoffMs,
  isDailyPodscanLimit,
  isTransientPodscanError,
  podscanBackoffMs,
  sleep,
  transientBackoffMs,
  withAppleRetries,
} from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
});

describe("rate limits", () => {
  it("keeps Podscan under the per-minute rate and the concurrency cap", async () => {
    const limiter = new HostLimiter(PODSCAN_PER_MINUTE, PODSCAN_CONCURRENCY, () => 0, async () => {});
    let active = 0;
    let maxActive = 0;
    const held: Array<() => void> = [];
    const waiting = Array.from({ length: 5 }, () =>
      limiter.acquire().then(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            held.push(() => {
              active -= 1;
              limiter.release();
              resolve();
            });
          })
      )
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(held).toHaveLength(PODSCAN_CONCURRENCY);
    expect(maxActive).toBe(PODSCAN_CONCURRENCY);
    let guard = 0;
    while (held.length > 0 && guard < 20) {
      const batch = held.splice(0);
      for (const release of batch) release();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      guard += 1;
    }
    await Promise.all(waiting);
    expect(maxActive).toBe(PODSCAN_CONCURRENCY);

    let now = 0;
    const waits: Array<{ ms: number; resolve: () => void }> = [];
    const paced = new HostLimiter(5, 5, () => now, (ms) => new Promise((resolve) => {
      waits.push({ ms, resolve });
    }));
    let granted = 0;
    const jobs = Array.from({ length: 7 }, () =>
      paced.acquire().then(() => {
        granted += 1;
        paced.release();
      })
    );
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(granted).toBe(5);
    const wait = waits[0];
    expect(wait).toBeTruthy();
    if (wait) {
      now += wait.ms;
      wait.resolve();
    }
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await Promise.all(jobs);
    expect(granted).toBe(7);
    expect(now).toBeGreaterThanOrEqual(60_000);
  });

  it("honors Retry-After and stops on a daily limit without another call", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const gate = new PodscanGate({
      maxCalls: 10,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: sleep,
      observe: () => ({ limit: 120, remaining: 50 }),
    });
    const pending = gate.run(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("rate"), { status: 429, retryAfter: 3, rateLimitRemaining: 50 });
      }
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(calls).toBe(2);

    let dailyCalls = 0;
    const daily = new PodscanGate({
      maxCalls: 10,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: sleep,
      observe: () => ({ limit: 120, remaining: 0 }),
    });
    await expect(
      daily.run(async () => {
        dailyCalls += 1;
        throw Object.assign(new Error("daily quota"), {
          status: 429,
          retryAfter: 7200,
          rateLimitRemaining: 0,
        });
      })
    ).rejects.toBeInstanceOf(PodscanStop);
    expect(dailyCalls).toBe(1);
    expect(isDailyPodscanLimit(429, "concurrency_limit_exceeded", 1, 0)).toBe(false);
    expect(podscanBackoffMs({ retryAfterSec: 3, remaining: 50, limit: 120 })).toBe(3000);
  });

  it("stops when the call budget is spent and saves that as a PodscanStop", async () => {
    const gate = new PodscanGate({
      maxCalls: 1,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: sleep,
      observe: () => ({ limit: 120, remaining: 100 }),
    });
    await gate.run(async () => "ok");
    await expect(gate.run(async () => "again")).rejects.toMatchObject({ name: "PodscanStop", reason: "budget" });
    expect(gate.callsUsed).toBe(1);
  });

  it("keeps Apple at 20 per minute and backs off on 403 and 429", async () => {
    vi.useFakeTimers();
    expect(appleBackoffMs(0, () => 0)).toBe(30_000);
    expect(appleBackoffMs(1, () => 0)).toBe(60_000);
    expect(appleBackoffMs(2, () => 0)).toBe(120_000);
    expect(appleBackoffMs(3, () => 0)).toBe(240_000);
    expect(appleBackoffMs(4, () => 0)).toBe(300_000);

    let now = 0;
    const waits: Array<{ ms: number; resolve: () => void }> = [];
    const limiter = new HostLimiter(APPLE_PER_MINUTE, APPLE_CONCURRENCY, () => now, (ms) => {
      return new Promise((resolve) => {
        waits.push({ ms, resolve });
      });
    });
    let granted = 0;
    const jobs = Array.from({ length: APPLE_PER_MINUTE + 1 }, () =>
      limiter.acquire().then(() => {
        granted += 1;
        limiter.release();
      })
    );
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    expect(granted).toBeLessThanOrEqual(APPLE_PER_MINUTE);
    const wait = waits[0];
    if (wait) {
      now += wait.ms;
      wait.resolve();
    }
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    await Promise.all(jobs);
    expect(granted).toBe(APPLE_PER_MINUTE + 1);

    const backoffs: number[] = [];
    let attempts = 0;
    const retryLimiter = new HostLimiter(20, 2, () => Date.now(), sleep);
    const pending = withAppleRetries(
      async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("apple"), { status: 403 });
        if (attempts === 2) throw Object.assign(new Error("apple"), { status: 429 });
        return "ok";
      },
      {
        limiter: retryLimiter,
        rng: () => 0,
        sleepFn: async (ms) => {
          backoffs.push(ms);
          await sleep(ms);
        },
      }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
    expect(attempts).toBe(3);
    expect(backoffs).toEqual([30_000, 60_000]);
  });

  it("retries a terminated fetch with increasing delay and counts every try", async () => {
    vi.useFakeTimers();
    const waits: number[] = [];
    let calls = 0;
    const gate = new PodscanGate({
      maxCalls: 10,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: async (ms) => {
        waits.push(ms);
        await sleep(ms);
      },
      observe: () => ({ limit: 120, remaining: 100 }),
    });
    const pending = gate.run(async () => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new TypeError("terminated"), {
          cause: Object.assign(new Error("socket hang up"), { code: "UND_ERR_SOCKET" }),
        });
      }
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(calls).toBe(3);
    expect(gate.callsUsed).toBe(3);
    expect(waits).toEqual([1_000, 2_000]);
    expect(transientBackoffMs(0)).toBe(1_000);
    expect(transientBackoffMs(3)).toBe(8_000);
  });

  it("stops after five transient tries and does not retry a 4xx", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const gate = new PodscanGate({
      maxCalls: 10,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: sleep,
      observe: () => ({ limit: 120, remaining: 100 }),
    });
    const pending = gate.run(async () => {
      calls += 1;
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      });
    });
    const failed = expect(pending).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000);
    await failed;
    expect(calls).toBe(TRANSIENT_ATTEMPTS);
    expect(gate.callsUsed).toBe(TRANSIENT_ATTEMPTS);

    let clientErrors = 0;
    const refused = new PodscanGate({
      maxCalls: 10,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: sleep,
      observe: () => ({ limit: 120, remaining: 100 }),
    });
    const bad = refused.run(async () => {
      clientErrors += 1;
      throw Object.assign(new Error("bad request"), { status: 400 });
    });
    const rejected = expect(bad).rejects.toMatchObject({ status: 400 });
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(clientErrors).toBe(1);
    expect(isTransientPodscanError(Object.assign(new Error("no"), { status: 404 }))).toBe(false);
    expect(isTransientPodscanError(Object.assign(new Error("down"), { status: 503 }))).toBe(true);
    expect(isTransientPodscanError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
    expect(isTransientPodscanError(new TypeError("unexpected search shape"))).toBe(false);

    let budgetCalls = 0;
    const limited = new PodscanGate({
      maxCalls: 2,
      limiter: new HostLimiter(100, 2, () => Date.now(), sleep),
      sleepFn: sleep,
      observe: () => ({ limit: 120, remaining: 100 }),
    });
    const budget = limited.run(async () => {
      budgetCalls += 1;
      throw new TypeError("terminated");
    });
    const stopped = expect(budget).rejects.toMatchObject({ name: "PodscanStop", reason: "budget" });
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    await stopped;
    expect(budgetCalls).toBe(2);
    expect(limited.callsUsed).toBe(2);
  });
});
