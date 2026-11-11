import { describe, expect, it } from "vitest";
import { createMemoryQuotaLedger, libraryQuotaCap } from "@/lib/youtube-library/quota";
import {
  AIRCHECK_RESERVE_FLOOR,
  AIRCHECK_RESERVE_MAX,
  AIRCHECK_UNITS_PER_SPOT,
  commitAircheckUnits,
  tomorrowReserve,
  YOUTUBE_SHARED_CEILING,
} from "./quota";

describe("caption quota sharing", () => {
  it("still accepts the reserve after the library has filled its cap", async () => {
    const ledger = createMemoryQuotaLedger();
    const reserve = AIRCHECK_RESERVE_FLOOR;
    const libraryCap = libraryQuotaCap(reserve);
    expect(libraryCap).toBe(8000);
    await ledger.commit("2026-11-11", libraryCap, "pull", libraryCap);
    const got = await commitAircheckUnits(ledger, "2026-11-11", reserve);
    expect(got).toEqual({ accepted: reserve, total: libraryCap + reserve });
    expect(libraryCap + reserve).toBeLessThanOrEqual(YOUTUBE_SHARED_CEILING);
  });

  it("writes tomorrow's reserve from the pending count, with a floor and a cap", () => {
    expect(tomorrowReserve({ pendingSpots: 0, activeConnections: 0 })).toBe(0);
    expect(tomorrowReserve({ pendingSpots: 20, activeConnections: 0 })).toBe(0);
    expect(tomorrowReserve({ pendingSpots: 0, activeConnections: 1 })).toBe(AIRCHECK_RESERVE_FLOOR);
    expect(tomorrowReserve({ pendingSpots: 2, activeConnections: 1 })).toBe(AIRCHECK_RESERVE_FLOOR);
    const eight = AIRCHECK_UNITS_PER_SPOT * 8;
    expect(tomorrowReserve({ pendingSpots: 8, activeConnections: 1 })).toBe(eight);
    expect(tomorrowReserve({ pendingSpots: 40, activeConnections: 3 })).toBe(AIRCHECK_RESERVE_MAX);
    expect(AIRCHECK_UNITS_PER_SPOT).toBe(253);
  });
});
