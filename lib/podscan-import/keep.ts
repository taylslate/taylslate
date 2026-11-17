// Pure keep rule for the Podscan import. Sponsors win. Audience is
// only a fallback, and a missing audience never passes a floor.

export const FLOORS = [1000, 2500, 5000] as const;
export type Floor = (typeof FLOORS)[number];

export interface KeepShow {
  sponsoredLast12m: boolean;
  audienceSize: number | null;
}

export type KeepReason = "sponsored" | "floor";

export function decideKeep(
  show: KeepShow,
  floor: number
): { kept: boolean; reason: KeepReason | null } {
  if (show.sponsoredLast12m) return { kept: true, reason: "sponsored" };
  if (show.audienceSize != null && show.audienceSize >= floor) {
    return { kept: true, reason: "floor" };
  }
  return { kept: false, reason: null };
}

export function countKept(shows: readonly KeepShow[], floor: number): number {
  let count = 0;
  for (const show of shows) {
    if (decideKeep(show, floor).kept) count += 1;
  }
  return count;
}

export function summarizeKeeps(shows: readonly KeepShow[]): {
  sponsored: number;
  kept: Record<Floor, number>;
} {
  let sponsored = 0;
  for (const show of shows) {
    if (show.sponsoredLast12m) sponsored += 1;
  }
  return {
    sponsored,
    kept: {
      1000: countKept(shows, 1000),
      2500: countKept(shows, 2500),
      5000: countKept(shows, 5000),
    },
  };
}
