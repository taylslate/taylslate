// Per-host sliding window. Podscan stays at 100/min under the live
// limit of 120. Apple stays at 20/min. A 429 waits on Retry-After
// and on X-RateLimit-Remaining. A daily-limit 429 stops the run.

export const PODSCAN_PER_MINUTE = 100;
export const PODSCAN_CONCURRENCY = 2;
export const APPLE_PER_MINUTE = 20;
export const APPLE_CONCURRENCY = 2;
export const DEFAULT_PODSCAN_BUDGET = 4500;
export const WINDOW_MS = 60_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class HostLimiter {
  private stamps: number[] = [];
  private active = 0;
  private pending: Array<() => void> = [];
  private waiting = false;

  constructor(
    private readonly perMinute: number,
    private readonly concurrency: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleepFn: (ms: number) => Promise<void> = sleep
  ) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.pump();
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.pump();
  }

  private prune(now: number): void {
    this.stamps = this.stamps.filter((stamp) => now - stamp < WINDOW_MS);
  }

  private pump(): void {
    const now = this.now();
    this.prune(now);
    while (
      this.pending.length > 0 &&
      this.active < this.concurrency &&
      this.stamps.length < this.perMinute
    ) {
      const resolve = this.pending.shift();
      if (!resolve) break;
      this.active += 1;
      this.stamps.push(this.now());
      resolve();
    }
    if (this.pending.length === 0 || this.active >= this.concurrency || this.waiting) {
      return;
    }
    if (this.stamps.length === 0) return;
    const waitMs = Math.max(1, this.stamps[0] + WINDOW_MS - this.now());
    this.waiting = true;
    void this.sleepFn(waitMs).then(() => {
      this.waiting = false;
      this.pump();
    });
  }
}

export type StopReason = "daily" | "budget";

export class PodscanStop extends Error {
  readonly reason: StopReason;

  constructor(reason: StopReason) {
    super(reason);
    this.name = "PodscanStop";
    this.reason = reason;
  }
}

export function isDailyPodscanLimit(
  status: number,
  message: string,
  retryAfterSec: number | null,
  remaining: number | null
): boolean {
  if (status !== 429) return false;
  const text = message.toLowerCase();
  if (text.includes("concurrency")) return false;
  if (text.includes("daily") || text.includes("per day") || text.includes("quota")) return true;
  if ((retryAfterSec ?? 0) >= 3600 && (remaining ?? 0) <= 0) return true;
  return false;
}

export function podscanBackoffMs(input: {
  retryAfterSec: number | null;
  remaining: number | null;
  limit: number | null;
}): number {
  const retryMs =
    input.retryAfterSec != null && input.retryAfterSec > 0 ? input.retryAfterSec * 1000 : 0;
  let remainingMs = 0;
  if (input.remaining != null && input.remaining <= 0) {
    remainingMs = WINDOW_MS;
  } else if (
    input.remaining != null &&
    input.limit != null &&
    input.limit > 0 &&
    input.remaining / input.limit < 0.1
  ) {
    remainingMs = 5_000;
  }
  return Math.max(retryMs, remainingMs, 1_000);
}

export function appleBackoffMs(failureIndex: number, rng: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** failureIndex, 5 * 60_000);
  return base + Math.floor(rng() * 1000);
}

interface ErrorShape {
  status: number;
  message: string;
  retryAfter: number | null;
  remaining: number | null;
}

function readErr(err: unknown): ErrorShape | null {
  if (!err || typeof err !== "object") return null;
  const value = err as {
    status?: unknown;
    message?: unknown;
    retryAfter?: unknown;
    rateLimitRemaining?: unknown;
  };
  if (typeof value.status !== "number") return null;
  return {
    status: value.status,
    message: typeof value.message === "string" ? value.message : "",
    retryAfter: typeof value.retryAfter === "number" ? value.retryAfter : null,
    remaining: typeof value.rateLimitRemaining === "number" ? value.rateLimitRemaining : null,
  };
}

export class PodscanGate {
  callsUsed = 0;
  firstLimit: number | null = null;
  firstRemaining: number | null = null;
  lastLimit: number | null = null;
  lastRemaining: number | null = null;
  private paceMs = 0;
  private stopped: StopReason | null = null;

  constructor(
    private readonly opts: {
      maxCalls: number;
      limiter: HostLimiter;
      sleepFn?: (ms: number) => Promise<void>;
      observe?: () => { limit: number | null; remaining: number | null };
      max429Retries?: number;
    }
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return this.attempt(fn, 0);
  }

  private note(extraRemaining: number | null): void {
    const observed = this.opts.observe?.() ?? { limit: null, remaining: null };
    const limit = observed.limit;
    const remaining = observed.remaining ?? extraRemaining;
    if (this.firstLimit == null && limit != null) this.firstLimit = limit;
    if (this.firstRemaining == null && remaining != null) this.firstRemaining = remaining;
    if (limit != null) this.lastLimit = limit;
    if (remaining != null) this.lastRemaining = remaining;
    if (limit != null && limit > 0 && remaining != null && remaining / limit < 0.1) {
      this.paceMs = Math.min(WINDOW_MS, Math.max(1_000, Math.ceil(WINDOW_MS / Math.max(remaining, 1))));
    } else if (remaining != null) {
      this.paceMs = 0;
    }
  }

  private async attempt<T>(fn: () => Promise<T>, retry: number): Promise<T> {
    if (this.stopped) throw new PodscanStop(this.stopped);
    if (this.callsUsed >= this.opts.maxCalls) {
      this.stopped = "budget";
      throw new PodscanStop("budget");
    }
    const sleepFn = this.opts.sleepFn ?? sleep;
    if (this.paceMs > 0) await sleepFn(this.paceMs);
    await this.opts.limiter.acquire();
    this.callsUsed += 1;
    let handedOff = false;
    try {
      const value = await fn();
      this.note(null);
      return value;
    } catch (err) {
      const info = readErr(err);
      this.note(info?.remaining ?? null);
      if (
        info &&
        isDailyPodscanLimit(info.status, info.message, info.retryAfter, info.remaining ?? this.lastRemaining)
      ) {
        this.stopped = "daily";
        throw new PodscanStop("daily");
      }
      const maxRetries = this.opts.max429Retries ?? 4;
      if (info && info.status === 429 && retry < maxRetries) {
        const wait = podscanBackoffMs({
          retryAfterSec: info.retryAfter,
          remaining: info.remaining ?? this.lastRemaining,
          limit: this.lastLimit,
        });
        this.opts.limiter.release();
        handedOff = true;
        await sleepFn(wait);
        return this.attempt(fn, retry + 1);
      }
      throw err;
    } finally {
      if (!handedOff) this.opts.limiter.release();
    }
  }
}

export async function withAppleRetries<T>(
  fn: () => Promise<T>,
  opts: {
    limiter: HostLimiter;
    sleepFn?: (ms: number) => Promise<void>;
    rng?: () => number;
  }
): Promise<T> {
  const sleepFn = opts.sleepFn ?? sleep;
  const rng = opts.rng ?? Math.random;
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await opts.limiter.acquire();
    try {
      const value = await fn();
      opts.limiter.release();
      return value;
    } catch (err) {
      opts.limiter.release();
      last = err;
      const info = readErr(err);
      const retry = info && (info.status === 403 || info.status === 429) && attempt < 4;
      if (retry) {
        await sleepFn(appleBackoffMs(attempt, rng));
        continue;
      }
      throw err;
    }
  }
  throw last;
}
