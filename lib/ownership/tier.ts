// Ownership tier for ranking and for owner or admin reads.
//
// Three stored values: unclaimed, claimed, verified.
// Claimed means a show account controls the show under the rule in
// lib/ownership/persist.ts: a sourced accept or signature whose recorded
// actor is that show user, or a server-created owner-{userId} row.
// A profile link or a brand-typed email is not enough.
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
