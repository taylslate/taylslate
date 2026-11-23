import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_RANK_BONUS,
  ownershipRankBonus,
  ownershipTier,
  ownershipTierForRead,
} from "./tier";

describe("ownershipTier", () => {
  it("reads the three stored values and treats anything else as unclaimed", () => {
    expect(ownershipTier({ ownership_status: "verified" })).toBe("verified");
    expect(ownershipTier({ ownership_status: "claimed" })).toBe("claimed");
    expect(ownershipTier({ ownership_status: "unclaimed" })).toBe("unclaimed");
    expect(ownershipTier({})).toBe("unclaimed");
    expect(ownershipTier({ ownership_status: "pending" })).toBe("unclaimed");
  });

  it("uses the computed profile tie only while the column is not claimed or verified", () => {
    expect(ownershipTierForRead("unclaimed", true)).toBe("claimed");
    expect(ownershipTierForRead(null, true)).toBe("claimed");
    expect(ownershipTierForRead("unclaimed", false)).toBe("unclaimed");
    expect(ownershipTierForRead("verified", true)).toBe("verified");
    expect(ownershipTierForRead("claimed", false)).toBe("claimed");
  });

  it("keeps the bonus small, with verified above claimed and unclaimed at zero", () => {
    expect(OWNERSHIP_RANK_BONUS).toEqual({ unclaimed: 0, claimed: 1, verified: 3 });
    expect(ownershipRankBonus({ ownership_status: "verified" })).toBe(3);
    expect(ownershipRankBonus({})).toBe(0);
    expect(OWNERSHIP_RANK_BONUS.verified).toBeGreaterThan(OWNERSHIP_RANK_BONUS.claimed);
    expect(OWNERSHIP_RANK_BONUS.verified).toBeLessThanOrEqual(3);
  });
});
