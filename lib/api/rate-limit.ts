// Durable per-key rate limit for /api/v1. The counter lives in
// api_rate_windows and increments in one Postgres upsert. This does
// not replace the in-process limiter in lib/utils/rate-limit.ts.

import { supabaseAdmin } from "@/lib/supabase/admin";

export const API_RATE_LIMIT_PER_MINUTE = 60;

let clock: () => Date = () => new Date();

/** Pins the window in tests. Pass null to restore the system clock. */
export function _setApiRateClockForTests(next: (() => Date) | null): void {
  clock = next ?? (() => new Date());
}

function apiRateNow(): Date {
  return clock();
}

export interface ApiRateLimitDecision {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

interface DbError {
  code?: string;
}

export function apiRateWindowStart(now: Date = new Date()): string {
  const start = new Date(now.getTime());
  start.setUTCSeconds(0, 0);
  return start.toISOString();
}

export function apiRateRetryAfterSec(now: Date = new Date()): number {
  const elapsedMs = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  return Math.max(1, Math.ceil((60_000 - elapsedMs) / 1000));
}

export async function enforceApiRateLimit(
  keyId: string,
  now: Date = apiRateNow()
): Promise<ApiRateLimitDecision> {
  const { data, error } = await supabaseAdmin.rpc("increment_api_rate_window", {
    p_key_id: keyId,
    p_window_start: apiRateWindowStart(now),
  });

  if (error || data == null || !Number.isFinite(Number(data))) {
    console.warn(
      "[api.rate-limit] increment failed:",
      (error as DbError | null)?.code ?? "unknown"
    );
    throw new Error("API rate limit failed.");
  }

  const count = Number(data);
  const limit = API_RATE_LIMIT_PER_MINUTE;
  if (count > limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      retryAfterSec: apiRateRetryAfterSec(now),
    };
  }

  return {
    ok: true,
    limit,
    remaining: limit - count,
    retryAfterSec: 0,
  };
}
