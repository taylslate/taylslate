// Per-episode PaymentIntent for the pay-as-delivers flow.
//
// CRITICAL FINANCIAL INVARIANT:
//   The platform fee is computed at charge time from
//   `profiles.platform_fee_percentage` for the brand making the charge.
//   The percentage AND the computed fee are snapshotted onto the
//   resulting `payments` row (`platform_fee_percentage_at_charge`,
//   `application_fee_amount_cents`) so a later plan change cannot
//   retroactively rewrite the historical fee. Never hardcode any rate.
//
// SEPARATE CHARGES AND TRANSFERS — the fee is NEVER sent to Stripe:
//   The PaymentIntent is created on the PLATFORM account (no
//   Stripe-Account header, no transfer_data), so Stripe rejects
//   `application_fee_amount` on it. The fee is collected implicitly:
//   lib/payouts/transfer.ts transfers only the show net
//   (amount_charged_cents − application_fee_amount_cents) to the show's
//   Connect account and the remainder stays on the platform balance.
//   The computed fee rides the PI metadata for Stripe-dashboard
//   reconciliation only — no code reads it back from Stripe.
//
// The flow:
//   1. Caller passes `{ dealId, ioLineItemId }` after verifying delivery.
//      An existing non-failed payments row for that pair short-circuits
//      (idempotent re-entry — retries converge instead of erroring).
//   2. We load the deal → brand profile → platform_fee_percentage.
//   3. We load the io_line_item → gross_rate (the dollar amount the
//      brand owes for this episode).
//   4. We compute `application_fee_amount_cents = gross_cents *
//      platform_fee_percentage` and create the PaymentIntent against the
//      brand's saved payment method (off-session, confirmed automatically).
//   5. We persist a `payments` row keyed by `stripe_payment_intent_id`
//      with the snapshotted percentage and fee.
//
// Settlement and payout: the `succeeded` status flips to `settled_at` on
// the `charge.succeeded` webhook. Show payouts (Teammate 3) MUST gate on
// the settled flag — payments.succeeded is not sufficient by itself.

import type Stripe from "stripe";
import { stripe } from "./server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";

export interface ChargeForEpisodeInput {
  dealId: string;
  ioLineItemId: string;
  /**
   * Optional Stripe idempotency key. Defaults to
   * `pi:v2:{dealId}:{ioLineItemId}` so retries collapse. Pass a fresh key
   * only to deliberately re-attempt a genuinely failed/declined charge.
   */
  idempotencyKey?: string;
}

export interface ChargeForEpisodeResult {
  paymentId: string;
  stripePaymentIntentId: string;
  amountChargedCents: number;
  applicationFeeAmountCents: number;
  platformFeePercentageAtCharge: number;
  status: string;
}

/**
 * Computes the platform fee for a gross amount in cents. Pure function —
 * exported so the test suite can hammer it without a Stripe mock.
 *
 * Round-half-up at the cent boundary so the fee is never silently
 * rounded down (which would underpay Taylslate by up to 1 cent per
 * charge in aggregate).
 */
export function computeApplicationFeeCents(
  amountCents: number,
  feePercentage: number
): number {
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new Error(`amountCents must be a non-negative finite number, got ${amountCents}`);
  }
  if (!Number.isFinite(feePercentage) || feePercentage < 0 || feePercentage > 1) {
    throw new Error(
      `feePercentage must be between 0 and 1 inclusive, got ${feePercentage}`
    );
  }
  return Math.round(amountCents * feePercentage);
}

interface DealRow {
  id: string;
  brand_id: string | null;
  brand_profile_id: string | null;
  payment_method_id: string | null;
}

interface BrandProfileRow {
  id: string;
  user_id: string;
}

interface ProfileRow {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  platform_fee_percentage: number | string;
}

interface IoLineItemRow {
  id: string;
  gross_rate: number | string;
}

interface ExistingPaymentRow {
  id: string;
  stripe_payment_intent_id: string | null;
  amount_charged_cents: number | string | null;
  application_fee_amount_cents: number | string | null;
  platform_fee_percentage_at_charge: number | string | null;
  status: string | null;
}

const EXISTING_PAYMENT_COLUMNS =
  "id,stripe_payment_intent_id,amount_charged_cents,application_fee_amount_cents,platform_fee_percentage_at_charge,status";

function resultFromPaymentRow(row: ExistingPaymentRow): ChargeForEpisodeResult {
  return {
    paymentId: row.id,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? "",
    amountChargedCents: Number(row.amount_charged_cents ?? 0),
    applicationFeeAmountCents: Number(row.application_fee_amount_cents ?? 0),
    platformFeePercentageAtCharge: Number(row.platform_fee_percentage_at_charge ?? 0),
    status: row.status ?? "pending",
  };
}

/**
 * Returns the existing Stripe-backed payment for (dealId, ioLineItemId),
 * if one is on file and not failed. Disputed/pending rows count — never
 * re-charge those. Throws on a read error: this guards a financial
 * write, so we fail closed rather than risk a duplicate charge.
 */
async function findExistingPayment(
  dealId: string,
  ioLineItemId: string
): Promise<ChargeForEpisodeResult | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(EXISTING_PAYMENT_COLUMNS)
    .eq("deal_id", dealId)
    .eq("io_line_item_id", ioLineItemId)
    .neq("status", "failed")
    .not("stripe_payment_intent_id", "is", null)
    .order("charged_at", { ascending: false })
    .limit(1)
    .maybeSingle<ExistingPaymentRow>();
  if (error) {
    throw new Error(
      `Failed to check for an existing payment on deal ${dealId} line ${ioLineItemId}: ${error.message}`
    );
  }
  return data ? resultFromPaymentRow(data) : null;
}

async function loadBrandProfile(deal: DealRow): Promise<ProfileRow> {
  // Wave 12 deals carry brand_profile_id; pre-Wave-12 deals carry brand_id
  // directly. Either path resolves to a profiles row that owns the
  // platform_fee_percentage we need to charge against.
  let userId: string | null = deal.brand_id ?? null;

  if (!userId && deal.brand_profile_id) {
    const { data: bp, error: bpErr } = await supabaseAdmin
      .from("brand_profiles")
      .select("id,user_id")
      .eq("id", deal.brand_profile_id)
      .single<BrandProfileRow>();
    if (bpErr || !bp) {
      throw new Error(
        `Deal ${deal.id} has brand_profile_id ${deal.brand_profile_id} but the brand_profiles row was not found: ${bpErr?.message ?? "missing"}`
      );
    }
    userId = bp.user_id;
  }

  if (!userId) {
    throw new Error(`Deal ${deal.id} has no brand_id or resolvable brand_profile_id`);
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id,email,stripe_customer_id,platform_fee_percentage")
    .eq("id", userId)
    .single<ProfileRow>();
  if (profileErr || !profile) {
    throw new Error(
      `Failed to load brand profile ${userId} for deal ${deal.id}: ${profileErr?.message ?? "missing"}`
    );
  }
  return profile;
}

/**
 * Charges the brand for one episode delivery. Idempotent on
 * `(deal_id, io_line_item_id)` three ways: the payments pre-check
 * (existing non-failed row returns without touching Stripe), Stripe's
 * idempotency key (a ~24h replay returns the same PaymentIntent), and
 * the `payments.stripe_payment_intent_id` unique index (a 23505 on
 * insert resolves to the existing row instead of throwing).
 *
 * Throws on missing data, Stripe error, or persistence error. Callers
 * should wrap in try/catch and surface the error to operations — we do
 * not silently swallow charge failures.
 */
export async function chargeForEpisode(
  input: ChargeForEpisodeInput
): Promise<ChargeForEpisodeResult> {
  // ---- Idempotent re-entry: already charged? ----
  // A prior charge for this (deal, line item) short-circuits here so
  // route-level retries converge to a success response instead of
  // replaying Stripe and tripping the stripe_payment_intent_id unique
  // index on the payments insert.
  const existing = await findExistingPayment(input.dealId, input.ioLineItemId);
  if (existing) {
    return existing;
  }

  // ---- Load the deal ----
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .select("id,brand_id,brand_profile_id,payment_method_id")
    .eq("id", input.dealId)
    .single<DealRow>();
  if (dealErr || !deal) {
    throw new Error(`Deal ${input.dealId} not found: ${dealErr?.message ?? "missing"}`);
  }

  // ---- Load the IO line item to get the gross dollar amount ----
  const { data: lineItem, error: liErr } = await supabaseAdmin
    .from("io_line_items")
    .select("id,gross_rate")
    .eq("id", input.ioLineItemId)
    .single<IoLineItemRow>();
  if (liErr || !lineItem) {
    throw new Error(
      `IO line item ${input.ioLineItemId} not found: ${liErr?.message ?? "missing"}`
    );
  }

  // ---- Resolve the brand profile and read fee percentage AT CHARGE TIME ----
  const profile = await loadBrandProfile(deal);
  if (!profile.stripe_customer_id) {
    throw new Error(
      `Brand profile ${profile.id} has no stripe_customer_id — SetupIntent must complete before any charge`
    );
  }
  const feePercentage = Number(profile.platform_fee_percentage);
  if (!Number.isFinite(feePercentage)) {
    throw new Error(
      `Brand profile ${profile.id} has invalid platform_fee_percentage ${profile.platform_fee_percentage}`
    );
  }

  // ---- Compute amounts (Stripe wants cents) ----
  const grossDollars = Number(lineItem.gross_rate);
  if (!Number.isFinite(grossDollars) || grossDollars <= 0) {
    throw new Error(
      `IO line item ${lineItem.id} has invalid gross_rate ${lineItem.gross_rate}`
    );
  }
  const amountCents = Math.round(grossDollars * 100);
  const applicationFeeCents = computeApplicationFeeCents(amountCents, feePercentage);

  // ---- Resolve the payment method saved for this signed deal ----
  let paymentMethodId = deal.payment_method_id ?? null;
  if (!paymentMethodId) {
    // Legacy/manual cards created from settings may only exist as the Stripe
    // Customer default. Deal-specific SetupIntents write deals.payment_method_id;
    // keep this fallback so old test/admin flows still charge cleanly.
    const customer = (await stripe.customers.retrieve(
      profile.stripe_customer_id
    )) as Stripe.Customer;
    paymentMethodId =
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id ?? null;
  }
  if (!paymentMethodId) {
    throw new Error(
      `Deal ${deal.id} has no saved payment_method_id and brand customer ${profile.stripe_customer_id} has no default payment method — SetupIntent confirmation required`
    );
  }

  // ---- Create the PaymentIntent (off-session, confirmed automatically) ----
  //
  // NO `application_fee_amount` here: this PI lives on the platform
  // account (separate charges & transfers) and Stripe rejects the param
  // outside direct/destination charges. The fee is snapshotted on the
  // payments row and collected via the show-net transfer; metadata
  // carries it for dashboard reconciliation only.
  //
  // Key versioning: Stripe binds an idempotency key to its exact params
  // for ~24h — a retry with the same key and different params returns
  // idempotency_error. ANY change to the create-params shape below MUST
  // bump the version segment (v2 → v3).
  const idempotencyKey =
    input.idempotencyKey ?? `pi:v2:${input.dealId}:${input.ioLineItemId}`;
  const paymentIntent = (await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "usd",
      customer: profile.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        deal_id: input.dealId,
        io_line_item_id: input.ioLineItemId,
        platform_fee_percentage_at_charge: String(feePercentage),
        application_fee_amount_cents: String(applicationFeeCents),
      },
    },
    { idempotencyKey }
  )) as Stripe.PaymentIntent;

  // ---- Persist a `payments` row, snapshotting the fee percentage ----
  const status = paymentIntent.status === "succeeded" ? "succeeded" : "pending";
  const { data: row, error: persistErr } = await supabaseAdmin
    .from("payments")
    .insert({
      deal_id: input.dealId,
      io_line_item_id: input.ioLineItemId,
      stripe_payment_intent_id: paymentIntent.id,
      amount_charged_cents: amountCents,
      application_fee_amount_cents: applicationFeeCents,
      platform_fee_percentage_at_charge: feePercentage,
      amount: grossDollars,
      method: "stripe",
      stripe_payment_id: paymentIntent.id,
      status,
      charged_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (persistErr || !row) {
    // Unique-index collision on stripe_payment_intent_id: a concurrent
    // or replayed call already persisted this exact PaymentIntent.
    // Treat as an idempotent replay and return the existing row (the
    // original call already logged the payment.charged event).
    if (persistErr?.code === "23505") {
      const { data: dupe, error: dupeErr } = await supabaseAdmin
        .from("payments")
        .select(EXISTING_PAYMENT_COLUMNS)
        .eq("stripe_payment_intent_id", paymentIntent.id)
        .single<ExistingPaymentRow>();
      if (!dupeErr && dupe) {
        return resultFromPaymentRow(dupe);
      }
    }
    throw new Error(
      `Failed to persist payments row for PaymentIntent ${paymentIntent.id}: ${persistErr?.message ?? "missing"}`
    );
  }

  // Audit. Never throws — fire-and-forget.
  await logEvent({
    eventType: "payment.charged",
    entityType: "payment",
    entityId: row.id,
    payload: {
      deal_id: input.dealId,
      io_line_item_id: input.ioLineItemId,
      stripe_payment_intent_id: paymentIntent.id,
      amount_charged_cents: amountCents,
      application_fee_amount_cents: applicationFeeCents,
      platform_fee_percentage_at_charge: feePercentage,
      status,
    },
  });

  return {
    paymentId: row.id,
    stripePaymentIntentId: paymentIntent.id,
    amountChargedCents: amountCents,
    applicationFeeAmountCents: applicationFeeCents,
    platformFeePercentageAtCharge: feePercentage,
    status,
  };
}
