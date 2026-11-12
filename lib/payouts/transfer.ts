// Pay-as-delivers Stripe Connect transfer helper.
//
// CRITICAL FINANCIAL INVARIANT. READ THIS FIRST:
//
//   transferPayoutForPayment() refuses to fire when payments.settled_at
//   IS NULL. The auto-payout flow hooks charge.succeeded, sets
//   settled_at, then calls this helper. If a caller invokes us before
//   settlement (for example on payment_intent.succeeded, which fires
//   earlier than charge.succeeded), we return null and DO NOT transfer.
//
//   This is the load-bearing rule. Brand charges that succeed in flight
//   but fail to actually settle would otherwise produce a payout to the
//   show. Taylslate would be on the hook for the float. Never bypass.
//
// Money math:
//   amount_to_show = payments.gross_amount_cents
//   (the IO rate, snapshotted at charge time). The brand was charged
//   that gross plus the platform fee. The fee stays on the platform
//   balance. Do not subtract application_fee_amount_cents. That would
//   take the fee out of the show.
//
// Funding (zero-float, part 2):
//   Every transfer passes source_transaction = the charge that funds
//   it, so Stripe draws the money from that specific charge, never the
//   platform's available balance, and settles the transfer when the
//   charge settles. Without it, a transfer against pending card funds
//   fails balance_insufficient (card charges take ~2 business days to
//   clear to available), or worse, silently spends platform capital.
//   This is Stripe's designed mechanism for separate charges and transfers.
//
// Owner gate:
//   After the settle gate, the field checks, and the already-transferred
//   return, a transfer runs only when isPayoutOwnerVerified(show_id,
//   show_profile_id) is true for the deal. A null id, a proof read
//   error, or a throw counts as not verified. Not verified inserts one
//   held payouts row (stripe_transfer_id null, transferred_at null,
//   amount_cents = gross, early_payout_fee_cents 0) and returns null.
//   Stripe is not called. A later verified call fills that same row.
//   A row that already has a stripe_transfer_id is never re-gated.
//
// Idempotency:
//   - Stripe transfer idempotency key: transfer:v2:{paymentId} so
//     retries collapse to the same Transfer object. The version segment
//     MUST be bumped on any change to the create-params shape (Stripe
//     binds a key to its exact params for ~24h; a same-key retry with
//     different params returns idempotency_error).
//   - DB-level: payouts has UNIQUE(payment_id), and a partial unique
//     index on stripe_transfer_id where it is not null.
//   - A held row is filled with a guarded update that matches
//     stripe_transfer_id IS NULL, so a second writer cannot overwrite
//     a transfer id.
//   - Before create, a held row adopts an existing Transfer in the
//     deal's transfer_group whose metadata.payment_id matches, whose
//     metadata.early_payout is not "true", and that is not reversed.
//     That covers a transfer created but not persisted after the
//     idempotency key has expired.

import type Stripe from "stripe";
import { getAuthEmail } from "@/lib/auth/auth-email";
import { logEvent } from "@/lib/data/events";
import { sendEmail } from "@/lib/email/send";
import { renderPayoutHeldEmail } from "@/lib/email/templates/payout-held";
import { isPayoutOwnerVerified } from "@/lib/ownership/payout-gate";
import { stripe } from "@/lib/stripe/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class PayoutHeldError extends Error {
  readonly code = "payout_held";

  constructor() {
    super("payout_held");
    this.name = "PayoutHeldError";
  }
}

export class PayoutAlreadyExistsError extends Error {
  readonly code = "payout_exists";

  constructor() {
    super("payout_exists");
    this.name = "PayoutAlreadyExistsError";
  }
}

export interface TransferPayoutResult {
  payoutId: string;
  stripeTransferId: string;
  amountCents: number;
}

interface PaymentRow {
  id: string;
  deal_id: string | null;
  io_line_item_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_charged_cents: number | null;
  application_fee_amount_cents: number | null;
  gross_amount_cents: number | null;
  settled_at: string | null;
  status: string | null;
}

interface DealShowRow {
  id: string;
  show_id: string | null;
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

interface DbError {
  code?: string;
  message?: string;
}

function logPayout(code: string | undefined): void {
  const safe = code && /^[A-Za-z0-9_]+$/.test(code) ? code : "unknown";
  console.error("[payouts]", safe);
}

async function loadPayment(paymentId: string): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(
      "id,deal_id,io_line_item_id,stripe_payment_intent_id,amount_charged_cents,application_fee_amount_cents,gross_amount_cents,settled_at,status"
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

async function loadDeal(dealId: string): Promise<DealShowRow> {
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .select("id,show_id,show_profile_id")
    .eq("id", dealId)
    .single<DealShowRow>();
  if (dealErr || !deal) {
    throw new Error(
      `Deal ${dealId} not found while resolving payout destination: ${dealErr?.message ?? "missing"}`
    );
  }
  return deal;
}

async function loadShowConnectAccount(deal: DealShowRow): Promise<string> {
  if (!deal.show_profile_id) {
    throw new Error(`Deal ${deal.id} has no show_profile_id; cannot route payout`);
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
      `Show profile ${sp.id} (user ${sp.user_id}) has no stripe_connect_account_id. Connect onboarding required before payout`
    );
  }
  return profile.stripe_connect_account_id;
}

/**
 * Resolves the charge id funding a settled payment, for
 * source_transaction. The settle gate guarantees a charge exists
 * whenever it is open (settled_at is only written by charge.succeeded),
 * so a missing latest_charge here is a data anomaly. Fail loud.
 */
async function resolveSourceChargeId(
  stripePaymentIntentId: string
): Promise<string> {
  const pi = (await stripe.paymentIntents.retrieve(
    stripePaymentIntentId
  )) as Stripe.PaymentIntent;
  const chargeId =
    typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id ?? null;
  if (!chargeId) {
    throw new Error(
      `PaymentIntent ${stripePaymentIntentId} has no latest_charge. Cannot fund transfer with source_transaction`
    );
  }
  return chargeId;
}

async function ownerIsVerified(deal: DealShowRow): Promise<boolean> {
  if (!deal.show_id || !deal.show_profile_id) return false;
  try {
    return await isPayoutOwnerVerified(deal.show_id, deal.show_profile_id);
  } catch {
    logPayout("owner_gate_threw");
    return false;
  }
}

async function notifyPayoutHeld(deal: DealShowRow): Promise<void> {
  try {
    let showName = "your show";
    if (deal.show_id) {
      const { data, error } = await supabaseAdmin
        .from("shows")
        .select("name")
        .eq("id", deal.show_id)
        .maybeSingle<{ name: string | null }>();
      if (error) {
        logPayout(error.code ?? "show_read");
      } else if (typeof data?.name === "string" && data.name.trim()) {
        showName = data.name.trim();
      }
    }
    if (!deal.show_profile_id) {
      logPayout("no_profile");
      return;
    }
    const { data: sp, error: spErr } = await supabaseAdmin
      .from("show_profiles")
      .select("user_id")
      .eq("id", deal.show_profile_id)
      .maybeSingle<{ user_id: string | null }>();
    if (spErr || !sp?.user_id) {
      logPayout(spErr?.code ?? "no_profile");
      return;
    }
    const to = await getAuthEmail(sp.user_id);
    if (!to) {
      logPayout("no_email");
      return;
    }
    const rendered = renderPayoutHeldEmail({ showName });
    const sent = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      recipientProfileId: sp.user_id,
    });
    if (!sent.ok) logPayout(sent.reason ?? "send_failed");
  } catch {
    logPayout("notify_threw");
  }
}

async function insertHeldPayout(
  payment: PaymentRow,
  amountCents: number,
  deal: DealShowRow
): Promise<void> {
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("payouts")
    .insert({
      payment_id: payment.id,
      stripe_transfer_id: null,
      amount_cents: amountCents,
      early_payout_fee_cents: 0,
      transferred_at: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (insErr) {
    if ((insErr as DbError).code === "23505") {
      await supabaseAdmin
        .from("payouts")
        .select("id,stripe_transfer_id,amount_cents,transferred_at")
        .eq("payment_id", payment.id)
        .maybeSingle<ExistingPayoutRow>();
      return;
    }
    logPayout((insErr as DbError).code ?? "payout_hold_failed");
    throw new Error("payout_hold_failed");
  }
  if (!inserted) {
    logPayout("payout_hold_failed");
    throw new Error("payout_hold_failed");
  }
  await logEvent({
    eventType: "payout.held",
    entityType: "payout",
    entityId: inserted.id,
    payload: {
      payment_id: payment.id,
      deal_id: payment.deal_id,
      amount_cents: amountCents,
    },
  });
  await notifyPayoutHeld(deal);
}

async function createSettledTransfer(
  payment: PaymentRow,
  amountCents: number,
  destination: string,
  sourceChargeId: string
): Promise<Stripe.Transfer> {
  // Key versioning: v1 params lacked source_transaction. ANY change to
  // the create-params shape below MUST bump the version segment (v2 to v3).
  return (await stripe.transfers.create(
    {
      amount: amountCents,
      currency: "usd",
      destination,
      source_transaction: sourceChargeId,
      transfer_group: payment.deal_id as string,
      metadata: {
        payment_id: payment.id,
        io_line_item_id: payment.io_line_item_id ?? "",
        deal_id: payment.deal_id as string,
      },
    },
    { idempotencyKey: `transfer:v2:${payment.id}` }
  )) as Stripe.Transfer;
}

async function adoptOpenTransfer(payment: PaymentRow): Promise<Stripe.Transfer | null> {
  const list = await stripe.transfers.list({
    transfer_group: payment.deal_id as string,
    limit: 100,
  });
  const found = (list.data ?? []).find((item) => {
    const meta = item.metadata ?? {};
    return (
      meta.payment_id === payment.id &&
      meta.early_payout !== "true" &&
      item.reversed !== true
    );
  });
  return found ?? null;
}

async function fillHeldPayout(
  existing: ExistingPayoutRow,
  transferId: string,
  amountCents: number
): Promise<{ payoutId: string; persisted: boolean }> {
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("payouts")
    .update({
      stripe_transfer_id: transferId,
      amount_cents: amountCents,
      transferred_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .is("stripe_transfer_id", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (updErr) {
    logPayout((updErr as DbError).code ?? "payout_persist_failed");
    throw new Error("payout_persist_failed");
  }
  if (updated) return { payoutId: updated.id, persisted: true };

  const { data: raced, error: readErr } = await supabaseAdmin
    .from("payouts")
    .select("id,stripe_transfer_id,amount_cents,transferred_at")
    .eq("id", existing.id)
    .maybeSingle<ExistingPayoutRow>();
  if (readErr) {
    logPayout((readErr as DbError).code ?? "payout_conflict");
    throw new Error("payout_conflict");
  }
  if (raced?.stripe_transfer_id === transferId) {
    return { payoutId: raced.id, persisted: false };
  }
  logPayout("payout_conflict");
  throw new Error("payout_conflict");
}

/**
 * Fire a Stripe Connect Transfer for the given payment, if and only if
 * the brand charge has settled and the deal's show owner is verified.
 * Returns the existing payout if one is already transferred (idempotent
 * re-entry), or null when the settle gate is closed or the payout is held.
 *
 * Throws on Stripe error or persistence error. A hold does not throw.
 */
export async function transferPayoutForPayment(
  paymentId: string
): Promise<TransferPayoutResult | null> {
  const payment = await loadPayment(paymentId);

  // ---- THE GATE. Load-bearing financial invariant ----
  if (!payment.settled_at) {
    return null;
  }

  if (
    payment.amount_charged_cents == null ||
    payment.application_fee_amount_cents == null ||
    payment.gross_amount_cents == null
  ) {
    throw new Error(
      `Payment ${paymentId} is settled but missing charge amounts (amount_charged_cents=${payment.amount_charged_cents}, application_fee_amount_cents=${payment.application_fee_amount_cents}, gross_amount_cents=${payment.gross_amount_cents})`
    );
  }
  if (!payment.deal_id) {
    throw new Error(
      `Payment ${paymentId} has no deal_id; cannot route payout to a show`
    );
  }
  if (!payment.stripe_payment_intent_id) {
    // A transfer without source_transaction would draw on the platform's
    // available balance. That is the float this module exists to prevent.
    throw new Error(
      `Payment ${paymentId} is settled but has no stripe_payment_intent_id. Cannot fund transfer with source_transaction`
    );
  }

  const showGrossCents = payment.gross_amount_cents;
  if (showGrossCents <= 0) {
    throw new Error(
      `Payment ${paymentId} has non-positive show gross (${showGrossCents}); refusing transfer`
    );
  }

  // ---- Idempotency check: already paid out? ----
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("payouts")
    .select("id,stripe_transfer_id,amount_cents,transferred_at")
    .eq("payment_id", paymentId)
    .maybeSingle<ExistingPayoutRow>();
  if (existingErr) {
    logPayout((existingErr as DbError).code ?? "payout_read_failed");
    throw new Error("payout_read_failed");
  }
  if (existing && existing.stripe_transfer_id) {
    return {
      payoutId: existing.id,
      stripeTransferId: existing.stripe_transfer_id,
      amountCents: existing.amount_cents,
    };
  }

  const deal = await loadDeal(payment.deal_id);
  const verified = await ownerIsVerified(deal);
  if (!verified) {
    if (!existing) await insertHeldPayout(payment, showGrossCents, deal);
    return null;
  }

  if (
    existing &&
    !existing.stripe_transfer_id &&
    (payment.status === "failed" || payment.status === "disputed")
  ) {
    return null;
  }

  // ---- Resolve destination + funding charge ----
  const destination = await loadShowConnectAccount(deal);
  const sourceChargeId = await resolveSourceChargeId(
    payment.stripe_payment_intent_id
  );

  let transfer: Stripe.Transfer;
  let persisted = true;
  let payoutId: string;
  const releasingHeld = Boolean(existing && !existing.stripe_transfer_id);
  if (releasingHeld && existing) {
    const adopted = await adoptOpenTransfer(payment);
    transfer = adopted ?? (await createSettledTransfer(
      payment,
      showGrossCents,
      destination,
      sourceChargeId
    ));
    const filled = await fillHeldPayout(existing, transfer.id, showGrossCents);
    payoutId = filled.payoutId;
    persisted = filled.persisted;
  } else {
    transfer = await createSettledTransfer(
      payment,
      showGrossCents,
      destination,
      sourceChargeId
    );
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("payouts")
      .insert({
        payment_id: payment.id,
        stripe_transfer_id: transfer.id,
        amount_cents: showGrossCents,
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

  if (!persisted) {
    return {
      payoutId,
      stripeTransferId: transfer.id,
      amountCents: showGrossCents,
    };
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
      amount_cents: showGrossCents,
      kind: "auto_after_settle",
    },
  });
  if (releasingHeld) {
    await logEvent({
      eventType: "payout.released",
      entityType: "payout",
      entityId: payoutId,
      payload: {
        payment_id: payment.id,
        stripe_transfer_id: transfer.id,
      },
    });
  }

  return {
    payoutId,
    stripeTransferId: transfer.id,
    amountCents: showGrossCents,
  };
}

/**
 * Early-payout variant. The show requests funds within the settle window
 * for a 2.5% fee on the IO gross. Same settle gate, same destination
 * resolution, different fee math. The platform fee is not part of this
 * deduction; the show's starting amount is the full gross.
 *
 * Refuses if any payout row exists for this payment (held or transferred).
 * An unverified owner throws PayoutHeldError and creates no row.
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
    payment.gross_amount_cents == null ||
    !payment.deal_id ||
    !payment.stripe_payment_intent_id
  ) {
    throw new Error(
      `Payment ${paymentId} is missing fields required for early payout`
    );
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("payouts")
    .select("id,stripe_transfer_id")
    .eq("payment_id", paymentId)
    .maybeSingle<{ id: string; stripe_transfer_id: string | null }>();
  if (existingErr) {
    logPayout((existingErr as DbError).code ?? "payout_read_failed");
    throw new Error("payout_read_failed");
  }
  if (existing) throw new PayoutAlreadyExistsError();

  const deal = await loadDeal(payment.deal_id);
  const verified = await ownerIsVerified(deal);
  if (!verified) throw new PayoutHeldError();

  const showGrossCents = payment.gross_amount_cents;
  // Round half-up at the cent boundary so the show is never silently
  // overpaid via fee under-collection.
  const earlyFeeCents = Math.round(showGrossCents * feePercentage);
  const transferCents = showGrossCents - earlyFeeCents;
  if (transferCents <= 0) {
    throw new Error(
      `Early payout for payment ${paymentId} would transfer ${transferCents} cents. Refusing`
    );
  }

  const destination = await loadShowConnectAccount(deal);
  const sourceChargeId = await resolveSourceChargeId(
    payment.stripe_payment_intent_id
  );

  // Key versioning: v1 params lacked source_transaction. ANY change to
  // the create-params shape below MUST bump the version segment (v2 to v3).
  const transfer = (await stripe.transfers.create(
    {
      amount: transferCents,
      currency: "usd",
      destination,
      source_transaction: sourceChargeId,
      transfer_group: payment.deal_id,
      metadata: {
        payment_id: payment.id,
        io_line_item_id: payment.io_line_item_id ?? "",
        deal_id: payment.deal_id,
        early_payout: "true",
        early_payout_fee_cents: String(earlyFeeCents),
      },
    },
    { idempotencyKey: `transfer-early:v2:${paymentId}` }
  )) as Stripe.Transfer;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("payouts")
    .insert({
      payment_id: payment.id,
      stripe_transfer_id: transfer.id,
      amount_cents: transferCents,
      early_payout_fee_cents: earlyFeeCents,
      transferred_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (insErr || !inserted) {
    throw new Error(
      `Failed to persist payouts row after early-payout transfer ${transfer.id}: ${insErr?.message ?? "missing"}`
    );
  }

  await logEvent({
    eventType: "payout.early_requested",
    entityType: "payout",
    entityId: inserted.id,
    payload: {
      payment_id: payment.id,
      deal_id: payment.deal_id,
      io_line_item_id: payment.io_line_item_id,
      stripe_transfer_id: transfer.id,
      destination,
      gross_amount_cents: showGrossCents,
      early_payout_fee_cents: earlyFeeCents,
      transferred_cents: transferCents,
      fee_percentage: feePercentage,
    },
  });
  await logEvent({
    eventType: "payout.transferred",
    entityType: "payout",
    entityId: inserted.id,
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
    payoutId: inserted.id,
    stripeTransferId: transfer.id,
    amountCents: transferCents,
  };
}
