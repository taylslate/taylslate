import type { ShowEpisodeCadence } from "@/lib/data/types";

// Days between episodes by cadence — used to space IO line-item post dates.
// Shared between the Wave 12 IO generator (lib/pdf/io-generator.ts) and the
// legacy IO route (app/api/deals/[id]/io/generate/route.ts) so the two can't
// drift — e.g. a new cadence added to one map but not the other silently falling
// back to weekly spacing.
export const CADENCE_DAYS: Record<ShowEpisodeCadence, number> = {
  daily: 1,
  multiple_weekly: 3, // ~2-4 episodes a week → roughly every 3 days
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  irregular: 7, // best-effort default for irregular cadence
};

export const DEFAULT_CADENCE_DAYS = 7;

/** Days between episodes for a cadence; falls back to weekly when unknown/null. */
export function cadenceDays(cadence: string | null | undefined): number {
  if (cadence && cadence in CADENCE_DAYS) {
    return CADENCE_DAYS[cadence as ShowEpisodeCadence];
  }
  return DEFAULT_CADENCE_DAYS;
}
