// Payout readiness. True only when a verified show_ownership_proofs
// row ties this show to this show profile.
//
// Callers: transferPayoutForPayment and transferEarlyPayoutForPayment
// in lib/payouts/transfer.ts. A false result holds the automatic
// payout or refuses an early payout. This file does not import
// lib/payouts, lib/stripe, lib/billing, or lib/airchecks.

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
      console.warn("[isPayoutOwnerVerified]", error.code ?? "unknown");
      return false;
    }
    return (data ?? []).length > 0;
  } catch {
    console.warn("[isPayoutOwnerVerified]", "threw");
    return false;
  }
}
