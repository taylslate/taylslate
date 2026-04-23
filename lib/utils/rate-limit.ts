// Tiny in-process rate limiter.
//
// Sized for the public outreach action endpoints (accept/counter/decline) where
// the load is microscopic — at most a handful of clicks per token in its lifetime.
// We only need to swat away a script that hammers the endpoint after stealing
// a token. Anything more sophisticated lives in WAF/CDN, not here.
//
// State is module-scoped so multiple Vercel invocations can drift; that's fine
// for this defense-in-depth layer. The DB still enforces the real terminal-state
// transition, so a stray request beyond the limit can't double-resolve a deal.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Token-bucket-ish: N requests per windowMs per key.
 * Defaults: 5 requests / 60 seconds.
 */
export function checkRateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, retryAfterSec: 0 };
}

/** Test helper — clears all buckets. */
export function _resetRateLimits(): void {
  buckets.clear();
}
