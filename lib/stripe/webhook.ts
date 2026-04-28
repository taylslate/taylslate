// Stripe webhook handler — verification + event dispatch.
//
// Stripe → POST /api/webhooks/stripe (route handler imports this lib).
// We verify the signature with stripe.webhooks.constructEvent (HMAC SHA-256
// keyed by STRIPE_WEBHOOK_SECRET), then route the typed event to a handler.
//
// CRITICAL FINANCIAL INVARIANT — the pay-as-delivers payout (Teammate 3)
// gates on `payments.settled_at`, NOT on `payments.status === 'succeeded'`.
// We set `settled_at` only on `charge.succeeded` (after Stripe has actually
// moved funds), even though `payment_intent.succeeded` fires earlier and
// flips status. This prevents a race where the brand charge succeeds in
// flight but the funds haven't arrived, and we transfer money out before
// it lands.
//
// Subscription events (`customer.subscription.updated|deleted`) update
// `profiles.subscription_status` and — when a downgrade reaches its
// period end — flip `platform_fee_percentage` back to PAYG (0.10).

import type Stripe from "stripe";
import { stripe } from "./server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";
import { finalizeDowngrade } from "@/lib/billing/subscription";

// Teammate 3 ships lib/payouts/transfer.ts with `transferPayoutForPayment`.
// We resolve it lazily so the webhook keeps building before that file
// lands; the wrapper falls back to a console.warn if the module isn't
// present yet. The fail-soft guarantee for transfers is also enforced
// here so a transfer failure can never break the webhook ack.
async function maybeTransferPayout(paymentId: string): Promise<void> {
  try {
    const mod = (await import("@/lib/payouts/transfer").catch(() => null)) as
      | { transferPayoutForPayment?: (id: string) => Promise<unknown> }
      | null;
    if (!mod?.transferPayoutForPayment) {
      console.warn(
        "[stripe.webhook] transferPayoutForPayment not yet available — payment_id=",
        paymentId
      );
      return;
    }
    await mod.transferPayoutForPayment(paymentId);
  } catch (err) {
    console.warn(
      "[stripe.webhook] transferPayoutForPayment failed:",
      err instanceof Error ? err.message : err,
      "payment_id=",
      paymentId
    );
  }
}

export const HANDLED_STRIPE_EVENTS = [
  "setup_intent.succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.succeeded",
  "charge.dispute.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

export interface VerifyAndHandleStripeEventInput {
  /** Raw request body — must be the unparsed bytes Stripe sent. */
  rawBody: string | Buffer;
  /** Value of the `stripe-signature` header on the inbound request. */
  signatureHeader: string | null | undefined;
}

export interface HandleResult {
  eventId: string;
  eventType: string;
  handled: boolean;
}

/**
 * Verifies the Stripe signature on the request and dispatches the event
 * to the matching handler. Throws on signature failure (caller should
 * return 400). Handler errors are caught and logged — we always 200 on
 * a verified event so Stripe doesn't retry against the same idempotent
 * state forever.
 */
export async function verifyAndHandleStripeEvent(
  input: VerifyAndHandleStripeEventInput
): Promise<HandleResult> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  }
  if (!input.signatureHeader) {
    throw new Error("Missing stripe-signature header");
  }

  // constructEvent throws on signature mismatch — that's the caller's
  // 400 path. We don't catch it here.
  const event = stripe.webhooks.constructEvent(
    input.rawBody,
    input.signatureHeader,
    secret
  ) as Stripe.Event;

  let handled = false;
  try {
    switch (event.type) {
      case "setup_intent.succeeded":
        await handleSetupIntentSucceeded(event);
        handled = true;
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event);
        handled = true;
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event);
        handled = true;
        break;
      case "charge.succeeded":
        await handleChargeSucceeded(event);
        handled = true;
        break;
      case "charge.dispute.created":
        await handleChargeDispute(event);
        handled = true;
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionEvent(event);
        handled = true;
        break;
      default:
        // Unhandled but verified — return success so Stripe stops retrying.
        handled = false;
    }
  } catch (err) {
    console.error(
      "[stripe.webhook] handler error:",
      err instanceof Error ? err.message : err,
      "type=",
      event.type,
      "id=",
      event.id
    );
  }

  return { eventId: event.id, eventType: event.type, handled };
}

// ---- Handlers ----

async function handleSetupIntentSucceeded(event: Stripe.Event): Promise<void> {
  const setupIntent = event.data.object as Stripe.SetupIntent;
  // The deal is wired in via metadata stamped at SetupIntent creation by
  // createSetupIntentForBrand. Without it we can't resolve a deal record.
  const dealId = setupIntent.metadata?.deal_id ?? null;
  if (!dealId) {
    console.warn(
      `[stripe.webhook] setup_intent.succeeded ${setupIntent.id} has no metadata.deal_id — ignoring`
    );
    return;
  }
  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id ?? null;
  if (!paymentMethodId) {
    console.warn(
      `[stripe.webhook] setup_intent.succeeded ${setupIntent.id} has no payment_method — ignoring`
    );
    return;
  }

  const { error } = await supabaseAdmin
    .from("deals")
    .update({ payment_method_id: paymentMethodId })
    .eq("id", dealId);
  if (error) {
    console.warn(
      `[stripe.webhook] failed to persist payment_method_id on deal ${dealId}: ${error.message}`
    );
    return;
  }

  await logEvent({
    eventType: "deal.setup_intent_completed",
    entityType: "deal",
    entityId: dealId,
    payload: {
      stripe_setup_intent_id: setupIntent.id,
      stripe_customer_id:
        typeof setupIntent.customer === "string"
          ? setupIntent.customer
          : setupIntent.customer?.id ?? null,
      payment_method_id: paymentMethodId,
    },
  });
}

async function handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  // Flip the payments row to `succeeded`. Settlement (and therefore
  // payout eligibility) waits for charge.succeeded.
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ status: "succeeded" })
    .eq("stripe_payment_intent_id", pi.id)
    .select("id,deal_id,io_line_item_id")
    .single<{ id: string; deal_id: string | null; io_line_item_id: string | null }>();
  if (error || !data) {
    console.warn(
      `[stripe.webhook] payment_intent.succeeded for unknown PI ${pi.id}: ${error?.message ?? "no row"}`
    );
    return;
  }
  await logEvent({
    eventType: "payment.charged",
    entityType: "payment",
    entityId: data.id,
    payload: {
      stripe_payment_intent_id: pi.id,
      deal_id: data.deal_id,
      io_line_item_id: data.io_line_item_id,
      status: "succeeded",
    },
  });
}

async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ status: "failed" })
    .eq("stripe_payment_intent_id", pi.id)
    .select("id,deal_id,io_line_item_id")
    .single<{ id: string; deal_id: string | null; io_line_item_id: string | null }>();
  if (error || !data) {
    console.warn(
      `[stripe.webhook] payment_intent.payment_failed for unknown PI ${pi.id}: ${error?.message ?? "no row"}`
    );
    return;
  }
  await logEvent({
    eventType: "payment.failed",
    entityType: "payment",
    entityId: data.id,
    payload: {
      stripe_payment_intent_id: pi.id,
      deal_id: data.deal_id,
      io_line_item_id: data.io_line_item_id,
      stripe_error_code: pi.last_payment_error?.code ?? null,
      stripe_error_message: pi.last_payment_error?.message ?? null,
    },
  });
}

async function handleChargeSucceeded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const piId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null;
  if (!piId) {
    console.warn(`[stripe.webhook] charge.succeeded ${charge.id} has no payment_intent`);
    return;
  }
  // Settlement marker — the load-bearing row for the payout-after-settle invariant.
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ settled_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", piId)
    .select("id,deal_id,io_line_item_id")
    .single<{ id: string; deal_id: string | null; io_line_item_id: string | null }>();
  if (error || !data) {
    console.warn(
      `[stripe.webhook] charge.succeeded for unknown PI ${piId}: ${error?.message ?? "no row"}`
    );
    return;
  }
  await logEvent({
    eventType: "payment.settled",
    entityType: "payment",
    entityId: data.id,
    payload: {
      stripe_payment_intent_id: piId,
      stripe_charge_id: charge.id,
      deal_id: data.deal_id,
      io_line_item_id: data.io_line_item_id,
    },
  });

  // Settlement reached — fire the show payout. Fail-soft via maybeTransferPayout
  // so a transfer failure never breaks the webhook ack (Stripe would otherwise
  // re-deliver charge.succeeded and we'd re-flip settled_at every retry). The
  // payout job is idempotent on payments.id so a manual retry path is safe.
  await maybeTransferPayout(data.id);
}

async function handleChargeDispute(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  const piId = typeof dispute.payment_intent === "string"
    ? dispute.payment_intent
    : dispute.payment_intent?.id ?? null;
  if (!piId) {
    console.warn(`[stripe.webhook] dispute ${dispute.id} has no payment_intent`);
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ status: "disputed" })
    .eq("stripe_payment_intent_id", piId)
    .select("id,deal_id")
    .single<{ id: string; deal_id: string | null }>();
  if (error || !data) {
    console.warn(
      `[stripe.webhook] charge.dispute.created for unknown PI ${piId}: ${error?.message ?? "no row"}`
    );
    return;
  }
  await logEvent({
    eventType: "payment.disputed",
    entityType: "payment",
    entityId: data.id,
    payload: {
      stripe_payment_intent_id: piId,
      stripe_dispute_id: dispute.id,
      reason: dispute.reason,
      amount: dispute.amount,
      deal_id: data.deal_id,
    },
  });
}

async function handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Find the profile that owns this Stripe customer.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id,plan,platform_fee_percentage")
    .eq("stripe_customer_id", customerId)
    .single<{ id: string; plan: string; platform_fee_percentage: number | string }>();
  if (profileErr || !profile) {
    console.warn(
      `[stripe.webhook] subscription event for unknown customer ${customerId}: ${profileErr?.message ?? "no profile"}`
    );
    return;
  }

  // Subscription deletion = downgrade to PAYG. Delegated to the canonical
  // billing helper so plan/fee/seat/subscription_status revert is single-
  // sourced (Teammate 2 owns finalizeDowngrade — it's idempotent and emits
  // its own customer.plan_changed domain event).
  if (event.type === "customer.subscription.deleted") {
    try {
      await finalizeDowngrade(profile.id);
    } catch (err) {
      console.error(
        `[stripe.webhook] finalizeDowngrade failed for profile ${profile.id}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
    return;
  }

  // customer.subscription.updated — mirror the live status onto the profile
  // but DO NOT touch plan / platform_fee_percentage. Those move through the
  // billing lib's upgrade/downgrade entrypoints (Teammate 2). A partial
  // helper for this path doesn't exist yet — keeping it inline until one is
  // published, per the team-lead's coordination note.
  const next = mapStripeSubStatus(sub.status, event.type);
  const { error: updErr } = await supabaseAdmin
    .from("profiles")
    .update({ subscription_status: next })
    .eq("id", profile.id);
  if (updErr) {
    console.error(
      `[stripe.webhook] failed to update subscription_status on profile ${profile.id}: ${updErr.message}`
    );
    return;
  }

  await logEvent({
    eventType: "subscription.updated",
    entityType: "profile",
    entityId: profile.id,
    payload: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_subscription_status: sub.status,
      next_subscription_status: next,
    },
  });
}

function mapStripeSubStatus(
  stripeStatus: Stripe.Subscription.Status,
  _eventType: string
): "none" | "active" | "past_due" | "canceled" | "trialing" {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "trialing":
      return "trialing";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      // incomplete / unpaid / paused — treat as past_due so dunning paths fire.
      return "past_due";
  }
}
