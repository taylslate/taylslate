// Per-episode PaymentIntent for the pay-as-delivers flow.
//
// CRITICAL FINANCIAL INVARIANT:
//   `application_fee_amount` is computed at charge time from
//   `profiles.platform_fee_percentage` for the brand making the charge.
//   The percentage is ALSO snapshotted onto the resulting `payments` row
//   (`platform_fee_percentage_at_charge`) so a later plan change cannot
//   retroactively rewrite the historical fee. Never hardcode any rate.
//
// The flow:
//   1. Caller passes `{ dealId, ioLineItemId }` after verifying delivery.
//   2. We load the deal → brand profile → platform_fee_percentage.
//   3. We load the io_line_item → gross_rate (the dollar amount the
//      brand owes for this episode).
//   4. We compute `application_fee_amount_cents = gross_cents *
//      platform_fee_percentage` and create the PaymentIntent against the
//      brand's saved payment method (off-session, confirmed automatically).
//   5. We persist a `payments` row keyed by `stripe_payment_intent_id`
//      with the snapshotted percentage.
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
  /** Optional Stripe idempotency key. Defaults to `pi:{dealId}:{ioLineItemId}` so retries collapse. */
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
 * `(deal_id, io_line_item_id)` via Stripe's idempotency key + the
 * `payments.stripe_payment_intent_id` unique index.
 *
 * Throws on missing data, Stripe error, or persistence error. Callers
 * should wrap in try/catch and surface the error to operations — we do
 * not silently swallow charge failures.
 */
export async function chargeForEpisode(
  input: ChargeForEpisodeInput
): Promise<ChargeForEpisodeResult> {
  // ---- Load the deal ----
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .select("id,brand_id,brand_profile_id")
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

  // ---- Pull the brand's default payment method (the one saved by SetupIntent) ----
  const customer = (await stripe.customers.retrieve(
    profile.stripe_customer_id
  )) as Stripe.Customer;
  const defaultPaymentMethod =
    typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id ?? null;
  if (!defaultPaymentMethod) {
    throw new Error(
      `Brand customer ${profile.stripe_customer_id} has no default payment method — SetupIntent confirmation required`
    );
  }

  // ---- Create the PaymentIntent (off-session, confirmed automatically) ----
  const idempotencyKey =
    input.idempotencyKey ?? `pi:${input.dealId}:${input.ioLineItemId}`;
  const paymentIntent = (await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "usd",
      customer: profile.stripe_customer_id,
      payment_method: defaultPaymentMethod,
      off_session: true,
      confirm: true,
      application_fee_amount: applicationFeeCents,
      metadata: {
        deal_id: input.dealId,
        io_line_item_id: input.ioLineItemId,
        platform_fee_percentage_at_charge: String(feePercentage),
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
