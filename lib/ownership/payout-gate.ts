// Payout readiness. True only when a verified show_ownership_proofs
// row ties this show to this show profile.
//
// Not wired. lib/payouts does not import this file, and this file
// does not import lib/payouts, lib/stripe, lib/billing, or
// lib/airchecks. Calling this before the first payout is a separate
// job that needs Chris's OK. Until that job lands, a payout can
// still run for an unverified owner.

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function isPayoutOwnerVerified(
  showId: string,
  showProfileId: string
): Promise<boolean> {
  if (!showId || !showProfileId) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("show_ownership_proofs")
      .select("id")
      .eq("show_id", showId)
      .eq("show_profile_id", showProfileId)
      .eq("status", "verified")
      .limit(1);
    if (error) {
      console.warn("[isPayoutOwnerVerified] proof read failed:", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  } catch (err) {
    console.warn(
      "[isPayoutOwnerVerified] threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
