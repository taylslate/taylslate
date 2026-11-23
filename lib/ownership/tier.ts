// Ownership tier for ranking and for owner or admin reads.
//
// Three stored values: unclaimed, claimed, verified.
// Claimed means a show account controls the show's profile, rates, and
// replies, and ownership is not verified yet. The exact ties are the
// non-proof branches of user_owns_show (migration 077) and
// getVerifiedProfileTies:
//   1. a deals row whose show_id is this show and whose show_profile_id
//      is set, or
//   2. a show_owner row (data_sources contains show_owner) whose
//      contact_email matches the auth login of a user who has a
//      show_profiles row.
// A verified show_ownership_proofs row is verified, not claimed.
// A pending proof is still only a tag. An agent roster claim is not a
// claim. shows.is_claimed is deprecated and is not read. A podscan id
// is not a tie.
//
// Before migration 100 the check constraint rejects 'claimed' (23514).
// Ranking then uses the rule above in memory. The column stays
// unclaimed until that write succeeds. Verified is never downgraded.

export const OWNERSHIP_TIERS = ["unclaimed", "claimed", "verified"] as const;

export type OwnershipTier = (typeof OWNERSHIP_TIERS)[number];

/**
 * Points added to the 0-100 conviction composite. A sort nudge.
 * Unclaimed shows stay in the list with no penalty. Verified is more
 * than claimed. Both are small next to audience fit and reach.
 */
export const OWNERSHIP_RANK_BONUS: Record<OwnershipTier, number> = {
  unclaimed: 0,
  claimed: 1,
  verified: 3,
};

export const OWNERSHIP_RANK_NOTE: Record<Exclude<OwnershipTier, "unclaimed">, string> = {
  claimed: "Claimed show. A small ranking bonus because a show account controls this profile.",
  verified: "Verified show. A small ranking bonus because ownership is verified.",
};

export function ownershipTier(show: {
  ownership_status?: string | null;
}): OwnershipTier {
  if (show.ownership_status === "verified") return "verified";
  if (show.ownership_status === "claimed") return "claimed";
  return "unclaimed";
}

export function ownershipRankBonus(show: {
  ownership_status?: string | null;
}): number {
  return OWNERSHIP_RANK_BONUS[ownershipTier(show)];
}

/**
 * Stored column when it is already claimed or verified. Otherwise the
 * computed profile tie, which is how ranking and API reads behave
 * before migration 100 can store claimed.
 */
export function ownershipTierForRead(
  stored: unknown,
  profileControlsShow: boolean
): OwnershipTier {
  if (stored === "verified" || stored === "claimed") return stored;
  if (profileControlsShow) return "claimed";
  return "unclaimed";
}
