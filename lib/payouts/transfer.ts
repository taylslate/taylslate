// Pay-as-delivers Stripe Connect transfer helper.
//
// CRITICAL FINANCIAL INVARIANT — READ THIS FIRST:
//
//   transferPayoutForPayment() refuses to fire when payments.settled_at
//   IS NULL. The auto-payout flow hooks `charge.succeeded` → set
//   settled_at → call this helper. If a caller invokes us before
//   settlement (e.g. on payment_intent.succeeded, which fires earlier
//   than charge.succeeded), we return null and DO NOT transfer.
//
//   This is the load-bearing rule. Brand charges that succeed in flight
//   but fail to actually settle would otherwise produce a payout to the
//   show — Taylslate would be on the hook for the float. Never bypass.
//
// Money math:
//   amount_to_show = payments.amount_charged_cents - payments.application_fee_amount_cents
//   (the show's net after Taylslate's platform fee, snapshotted at
//   charge time on the payments row).
//
// Idempotency:
//   - Stripe transfer idempotency key: `transfer:{paymentId}` so retries
//     collapse to the same Transfer object.
//   - DB-level: payouts table has UNIQUE(payment_id), so a second insert
//     attempt fails fast.
//   - We pre-check the payouts table; if a row already exists, return it.

import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";

export interface TransferPayoutResult {
  payoutId: string;
  stripeTransferId: string;
  amountCents: number;
}

interface PaymentRow {
  id: string;
  deal_id: string | null;
  io_line_item_id: string | null;
  amount_charged_cents: number | null;
  application_fee_amount_cents: number | null;
  settled_at: string | null;
}

interface DealShowRow {
  id: string;
  show_profile_id: string | null;
}

interface ShowProfileRow {
  id: string;
  user_id: string;
}

interface ShowConnectRow {
  id: string;
  stripe_connect_account_id: string | null;
}

interface ExistingPayoutRow {
  id: string;
  stripe_transfer_id: string | null;
  amount_cents: number;
  transferred_at: string | null;
}

async function loadPayment(paymentId: string): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(
      "id,deal_id,io_line_item_id,amount_charged_cents,application_fee_amount_cents,settled_at"
    )
    .eq("id", paymentId)
    .single<PaymentRow>();
  if (error || !data) {
    throw new Error(
      `Payment ${paymentId} not found: ${error?.message ?? "missing"}`
    );
  }
  return data;
}

async function loadShowConnectAccount(dealId: string): Promise<string> {
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .select("id,show_profile_id")
    .eq("id", dealId)
    .single<DealShowRow>();
  if (dealErr || !deal) {
    throw new Error(
      `Deal ${dealId} not found while resolving payout destination: ${dealErr?.message ?? "missing"}`
    );
  }
  if (!deal.show_profile_id) {
    throw new Error(`Deal ${dealId} has no show_profile_id; cannot route payout`);
  }
  const { data: sp, error: spErr } = await supabaseAdmin
    .from("show_profiles")
    .select("id,user_id")
    .eq("id", deal.show_profile_id)
    .single<ShowProfileRow>();
  if (spErr || !sp) {
    throw new Error(
      `Show profile ${deal.show_profile_id} not found: ${spErr?.message ?? "missing"}`
    );
  }
  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id,stripe_connect_account_id")
    .eq("id", sp.user_id)
    .single<ShowConnectRow>();
  if (profErr || !profile) {
    throw new Error(
      `Profile ${sp.user_id} not found while resolving payout destination: ${profErr?.message ?? "missing"}`
    );
  }
  if (!profile.stripe_connect_account_id) {
    throw new Error(
      `Show profile ${sp.id} (user ${sp.user_id}) has no stripe_connect_account_id — Connect onboarding required before payout`
    );
  }
  return profile.stripe_connect_account_id;
}

/**
 * Fire a Stripe Connect Transfer for the given payment, if and only if
 * the brand charge has settled. Returns the existing payout if one is
 * already on file (idempotent re-entry), or null when the gate is closed.
 *
 * Throws on Stripe error or persistence error.
 */
export async function transferPayoutForPayment(
  paymentId: string
): Promise<TransferPayoutResult | null> {
  const payment = await loadPayment(paymentId);

  // ---- THE GATE — load-bearing financial invariant ----
  if (!payment.settled_at) {
    return null;
  }

  if (
    payment.amount_charged_cents == null ||
    payment.application_fee_amount_cents == null
  ) {
    throw new Error(
      `Payment ${paymentId} is settled but missing charge amounts (amount_charged_cents=${payment.amount_charged_cents}, application_fee_amount_cents=${payment.application_fee_amount_cents})`
    );
  }
  if (!payment.deal_id) {
    throw new Error(
      `Payment ${paymentId} has no deal_id; cannot route payout to a show`
    );
  }

  const showNetCents =
    payment.amount_charged_cents - payment.application_fee_amount_cents;
  if (showNetCents <= 0) {
    throw new Error(
      `Payment ${paymentId} has non-positive show net (${showNetCents}); refusing transfer`
    );
  }

  // ---- Idempotency check: already paid out? ----
  const { data: existing } = await supabaseAdmin
    .from("payouts")
    .select("id,stripe_transfer_id,amount_cents,transferred_at")
    .eq("payment_id", paymentId)
    .maybeSingle<ExistingPayoutRow>();
  if (existing && existing.stripe_transfer_id) {
    return {
      payoutId: existing.id,
      stripeTransferId: existing.stripe_transfer_id,
      amountCents: existing.amount_cents,
    };
  }

  // ---- Resolve destination ----
  const destination = await loadShowConnectAccount(payment.deal_id);

  // ---- Create the Stripe Transfer ----
  const transfer = (await stripe.transfers.create(
    {
      amount: showNetCents,
      currency: "usd",
      destination,
      transfer_group: payment.deal_id,
      metadata: {
        payment_id: payment.id,
        io_line_item_id: payment.io_line_item_id ?? "",
        deal_id: payment.deal_id,
      },
    },
    { idempotencyKey: `transfer:${paymentId}` }
  )) as Stripe.Transfer;

  // ---- Persist the payouts row (or update an existing pending row) ----
  let payoutId: string;
  if (existing) {
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("payouts")
      .update({
        stripe_transfer_id: transfer.id,
        amount_cents: showNetCents,
        transferred_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id")
      .single<{ id: string }>();
    if (updErr || !updated) {
      throw new Error(
        `Failed to update payouts row ${existing.id} after Stripe transfer ${transfer.id}: ${updErr?.message ?? "missing"}`
      );
    }
    payoutId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("payouts")
      .insert({
        payment_id: payment.id,
        stripe_transfer_id: transfer.id,
        amount_cents: showNetCents,
        early_payout_fee_cents: 0,
        transferred_at: new Date().toISOString(),
      })
      .select("id")
      .single<{ id: string }>();
    if (insErr || !inserted) {
      throw new Error(
        `Failed to persist payouts row after Stripe transfer ${transfer.id}: ${insErr?.message ?? "missing"}`
      );
    }
    payoutId = inserted.id;
  }

  await logEvent({
    eventType: "payout.transferred",
    entityType: "payout",
    entityId: payoutId,
    payload: {
      payment_id: payment.id,
      deal_id: payment.deal_id,
      io_line_item_id: payment.io_line_item_id,
      stripe_transfer_id: transfer.id,
      destination,
      amount_cents: showNetCents,
      kind: "auto_after_settle",
    },
  });

  return {
    payoutId,
    stripeTransferId: transfer.id,
    amountCents: showNetCents,
  };
}

/**
 * Early-payout variant — show requests funds within the settle window
 * for a 2.5% fee on the show net. Same settle-gate, same destination
 * resolution, different fee math.
 *
 * Refuses if a payout already exists for this payment (auto-payout
 * already fired, or duplicate request).
 */
export async function transferEarlyPayoutForPayment(
  paymentId: string,
  feePercentage: number
): Promise<TransferPayoutResult> {
  if (!Number.isFinite(feePercentage) || feePercentage < 0 || feePercentage >= 1) {
    throw new Error(
      `feePercentage must be in [0, 1), got ${feePercentage}`
    );
  }
  const payment = await loadPayment(paymentId);
  if (!payment.settled_at) {
    throw new Error(
      `Payment ${paymentId} has not settled; early payout requires settlement`
    );
  }
  if (
    payment.amount_charged_cents == null ||
    payment.application_fee_amount_cents == null ||
    !payment.deal_id
  ) {
    throw new Error(
      `Payment ${paymentId} is missing fields required for early payout`
    );
  }

  // No double payout. Existing row with a transfer id => refuse.
  const { data: existing } = await supabaseAdmin
    .from("payouts")
    .select("id,stripe_transfer_id")
    .eq("payment_id", paymentId)
    .maybeSingle<{ id: string; stripe_transfer_id: string | null }>();
  if (existing?.stripe_transfer_id) {
    throw new Error(
      `Payment ${paymentId} already has a payout (transfer ${existing.stripe_transfer_id})`
    );
  }

  const showNetCents =
    payment.amount_charged_cents - payment.application_fee_amount_cents;
  // Round half-up at the cent boundary so the show is never silently
  // overpaid via fee under-collection.
  const earlyFeeCents = Math.round(showNetCents * feePercentage);
  const transferCents = showNetCents - earlyFeeCents;
  if (transferCents <= 0) {
    throw new Error(
      `Early payout for payment ${paymentId} would transfer ${transferCents} cents — refusing`
    );
  }

  const destination = await loadShowConnectAccount(payment.deal_id);

  const transfer = (await stripe.transfers.create(
    {
      amount: transferCents,
      currency: "usd",
      destination,
      transfer_group: payment.deal_id,
      metadata: {
        payment_id: payment.id,
        io_line_item_id: payment.io_line_item_id ?? "",
        deal_id: payment.deal_id,
        early_payout: "true",
        early_payout_fee_cents: String(earlyFeeCents),
      },
    },
    { idempotencyKey: `transfer-early:${paymentId}` }
  )) as Stripe.Transfer;

  const payoutValues = {
    payment_id: payment.id,
    stripe_transfer_id: transfer.id,
    amount_cents: transferCents,
    early_payout_fee_cents: earlyFeeCents,
    transferred_at: new Date().toISOString(),
  };

  let payoutId: string;
  if (existing) {
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("payouts")
      .update(payoutValues)
      .eq("id", existing.id)
      .select("id")
      .single<{ id: string }>();
    if (updErr || !updated) {
      throw new Error(
        `Failed to update payouts row ${existing.id} after early-payout transfer ${transfer.id}: ${updErr?.message ?? "missing"}`
      );
    }
    payoutId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("payouts")
      .insert(payoutValues)
      .select("id")
      .single<{ id: string }>();
    if (insErr || !inserted) {
      throw new Error(
        `Failed to persist payouts row after early-payout transfer ${transfer.id}: ${insErr?.message ?? "missing"}`
      );
    }
    payoutId = inserted.id;
  }

  await logEvent({
    eventType: "payout.early_requested",
    entityType: "payout",
    entityId: payoutId,
    payload: {
      payment_id: payment.id,
      deal_id: payment.deal_id,
      io_line_item_id: payment.io_line_item_id,
      stripe_transfer_id: transfer.id,
      destination,
      gross_show_net_cents: showNetCents,
      early_payout_fee_cents: earlyFeeCents,
      transferred_cents: transferCents,
      fee_percentage: feePercentage,
    },
  });
  await logEvent({
    eventType: "payout.transferred",
    entityType: "payout",
    entityId: payoutId,
    payload: {
      payment_id: payment.id,
      deal_id: payment.deal_id,
      io_line_item_id: payment.io_line_item_id,
      stripe_transfer_id: transfer.id,
      destination,
      amount_cents: transferCents,
      kind: "early_request",
    },
  });

  return {
    payoutId,
    stripeTransferId: transfer.id,
    amountCents: transferCents,
  };
}
