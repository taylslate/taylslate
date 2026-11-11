// Caption checks commit against the shared 9,800 ceiling.
// The library yields `reserve` units first. Analytics reports
// are a different API and are not committed here.

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  pacificDay,
  YOUTUBE_SHARED_CEILING,
  type QuotaCommit,
  type QuotaLedger,
} from "@/lib/youtube-library/quota";

export const AIRCHECK_EPISODE_UNITS = 3;
export const AIRCHECK_CAPTION_UNITS = 250;
export const AIRCHECK_UNITS_PER_SPOT = AIRCHECK_EPISODE_UNITS + AIRCHECK_CAPTION_UNITS;
export const AIRCHECK_RESERVE_FLOOR = 1_800;
export const AIRCHECK_RESERVE_MAX = 4_000;

export { YOUTUBE_SHARED_CEILING };

export function nextPacificDay(now: Date): string {
  const today = pacificDay(now);
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** Floor 1,800 while any connection is active, else 0. Clamped at 4,000. */
export function tomorrowReserve(input: { pendingSpots: number; activeConnections: number }): number {
  if (input.activeConnections <= 0) return 0;
  const pending = Math.max(0, Math.floor(input.pendingSpots));
  const fromPending = AIRCHECK_UNITS_PER_SPOT * pending;
  return Math.min(AIRCHECK_RESERVE_MAX, Math.max(AIRCHECK_RESERVE_FLOOR, fromPending));
}

export async function commitAircheckUnits(
  ledger: QuotaLedger,
  day: string,
  units: number
): Promise<QuotaCommit> {
  return ledger.commit(day, units, "aircheck_captions", YOUTUBE_SHARED_CEILING);
}

function missingQuota(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "42883" ||
    code === "42P01" ||
    code === "PGRST202" ||
    message.includes("unknown job") ||
    message.includes("could not find the function")
  );
}

export async function commitLiveAircheckUnits(
  day: string,
  units: number
): Promise<QuotaCommit & { missing: boolean }> {
  const { data, error } = await supabaseAdmin.rpc("youtube_quota_commit", {
    p_day: day,
    p_units: units,
    p_job: "aircheck_captions",
    p_cap: YOUTUBE_SHARED_CEILING,
  });
  if (error) {
    if (missingQuota(error)) return { accepted: 0, total: 0, missing: true };
    throw new Error("youtube quota commit failed");
  }
  const payload = (typeof data === "string" ? JSON.parse(data) : data) as {
    accepted?: number;
    total?: number;
  } | null;
  return {
    accepted: Number(payload?.accepted ?? 0),
    total: Number(payload?.total ?? 0),
    missing: false,
  };
}

export async function setLiveAircheckReserve(day: string, units: number): Promise<void> {
  const { error } = await supabaseAdmin.rpc("youtube_quota_set_reserve", {
    p_day: day,
    p_units: units,
  });
  if (error && !missingQuota(error)) throw new Error("youtube quota reserve failed");
}
