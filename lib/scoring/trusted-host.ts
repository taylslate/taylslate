// ============================================================
// TRUSTED HOST, first-time brands
//
// A small composite bump for a host a brand can start with: the show
// is ownership-verified, or it already has a recorded sponsor.
// Applied only when the brand has no prior campaign. The note is part
// of the score so the bump is visible. It never removes a show, and
// it does not run for a brand that has already bought.
//
// Verification points live in OWNERSHIP_RANK_BONUS and apply on every
// campaign. trustedHostBump therefore adds this bump for a recorded
// sponsor, and for a verified host only when that ranking bonus is
// not already counting verification. shows.is_verified is not read.
// ============================================================

import { ownershipTier } from "@/lib/ownership/tier";

/** Points added to the composite. Small on purpose. A sort nudge. */
export const TRUSTED_HOST_COMPOSITE_BUMP = 2;

export const TRUSTED_HOST_NOTE =
  "Trusted host, weighted a little higher because this brand is buying its first campaign.";

type TrustedShow = {
  ownership_status?: string | null;
  current_sponsors?: string[] | null;
  past_sponsors?: string[] | null;
};

export function isTrustedHost(show: TrustedShow): boolean {
  if (ownershipTier(show) === "verified") return true;
  return sponsorNames(show.current_sponsors).length > 0 || sponsorNames(show.past_sponsors).length > 0;
}

/**
 * Whether the first-campaign bump should add points. A verified host
 * is trusted, and those points are the ownership ranking bonus, so
 * this returns true for a recorded sponsor. It returns true for a
 * verified host only when the caller is not also applying that bonus.
 */
export function trustedHostBump(show: TrustedShow, ownershipBonusAlreadyApplied: boolean): boolean {
  if (!isTrustedHost(show)) return false;
  if (ownershipTier(show) === "verified" && ownershipBonusAlreadyApplied && !hasRecordedSponsor(show)) {
    return false;
  }
  return true;
}

export function hasRecordedSponsor(show: TrustedShow): boolean {
  return sponsorNames(show.current_sponsors).length > 0 || sponsorNames(show.past_sponsors).length > 0;
}

function sponsorNames(names: string[] | null | undefined): string[] {
  if (!names) return [];
  return names.filter((name) => typeof name === "string" && name.trim().length > 0);
}
