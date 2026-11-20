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
  floor: number,
  opts?: { floorSponsored?: boolean }
): { kept: boolean; reason: KeepReason | null } {
  const meetsFloor = show.audienceSize != null && show.audienceSize >= floor;
  if (show.sponsoredLast12m && !opts?.floorSponsored) {
    return { kept: true, reason: "sponsored" };
  }
  if (meetsFloor) {
    return { kept: true, reason: show.sponsoredLast12m ? "sponsored" : "floor" };
  }
  return { kept: false, reason: null };
}

export function countKept(
  shows: readonly KeepShow[],
  floor: number,
  opts?: { floorSponsored?: boolean }
): number {
  let count = 0;
  for (const show of shows) {
    if (decideKeep(show, floor, opts).kept) count += 1;
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
