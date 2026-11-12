// Release held payouts after the show owner is verified.
//
// A held row has stripe_transfer_id null. transferPayoutForPayment
// re-checks the owner and fills the row, or leaves it held.
// This module never throws. Logs are codes only.

import { transferPayoutForPayment } from "@/lib/payouts/transfer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface PayoutReleaseCounts {
  released: number;
  held: number;
  failed: number;
}

const CAP = 100;

function logRelease(code: string | undefined): void {
  const safe = code && /^[A-Za-z0-9_]+$/.test(code) ? code : "unknown";
  console.error("[payout-release]", safe);
}

function thrownCode(err: unknown): string {
  if (err instanceof Error && /^[A-Za-z0-9_]+$/.test(err.name)) return err.name;
  return "throw";
}

function empty(): PayoutReleaseCounts {
  return { released: 0, held: 0, failed: 0 };
}

async function runPayments(paymentIds: string[]): Promise<PayoutReleaseCounts> {
  const counts = empty();
  for (const paymentId of paymentIds.slice(0, CAP)) {
    if (!paymentId) continue;
    try {
      const result = await transferPayoutForPayment(paymentId);
      if (result) counts.released += 1;
      else counts.held += 1;
    } catch (err) {
      counts.failed += 1;
      logRelease(thrownCode(err));
    }
  }
  return counts;
}

/**
 * Release held payouts for deals whose show_id and show_profile_id match
 * the verified proof for this show. One payment at a time. Safe to call
 * again: a filled row is not selected, and transferPayoutForPayment
 * returns an existing transfer without creating another.
 */
export async function releaseHeldPayoutsForShow(showId: string): Promise<PayoutReleaseCounts> {
  try {
    if (!showId) return empty();
    const { data: proofs, error: proofErr } = await supabaseAdmin
      .from("show_ownership_proofs")
      .select("show_profile_id")
      .eq("show_id", showId)
      .eq("status", "verified")
      .limit(1);
    if (proofErr) {
      logRelease(proofErr.code);
      return empty();
    }
    const showProfileId = (proofs ?? []).find(
      (row) => typeof row.show_profile_id === "string" && row.show_profile_id.length > 0
    )?.show_profile_id;
    if (!showProfileId) return empty();

    const { data: deals, error: dealErr } = await supabaseAdmin
      .from("deals")
      .select("id")
      .eq("show_id", showId)
      .eq("show_profile_id", showProfileId);
    if (dealErr) {
      logRelease(dealErr.code);
      return empty();
    }
    const dealIds = (deals ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (dealIds.length === 0) return empty();

    const { data: payments, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("id")
      .in("deal_id", dealIds)
      .not("settled_at", "is", null);
    if (payErr) {
      logRelease(payErr.code);
      return empty();
    }
    const paymentIds = (payments ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (paymentIds.length === 0) return empty();

    const { data: held, error: heldErr } = await supabaseAdmin
      .from("payouts")
      .select("payment_id")
      .in("payment_id", paymentIds)
      .is("stripe_transfer_id", null)
      .order("created_at", { ascending: true })
      .limit(CAP);
    if (heldErr) {
      logRelease(heldErr.code);
      return empty();
    }
    const ids = (held ?? [])
      .map((row) => row.payment_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return await runPayments(ids);
  } catch (err) {
    logRelease(thrownCode(err));
    return empty();
  }
}

/**
 * Oldest held rows, re-gated by transferPayoutForPayment.
 * An unverified owner stays held and the row is not written.
 */
export async function sweepHeldPayouts(): Promise<PayoutReleaseCounts> {
  try {
    const { data, error } = await supabaseAdmin
      .from("payouts")
      .select("payment_id")
      .is("stripe_transfer_id", null)
      .order("created_at", { ascending: true })
      .limit(CAP);
    if (error) {
      logRelease(error.code);
      return empty();
    }
    const ids = (data ?? [])
      .map((row) => row.payment_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return await runPayments(ids);
  } catch (err) {
    logRelease(thrownCode(err));
    return empty();
  }
}
