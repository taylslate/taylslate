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

export const HANDLED_STRIPE_EVENTS = [
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

  // Stripe statuses we care about: active, past_due, canceled, trialing.
  const update: Record<string, unknown> = {
    subscription_status: mapStripeSubStatus(sub.status, event.type),
  };

  // Subscription deletion = downgrade to PAYG. Reset the fee to 0.10 and
  // unset the subscription id so future writes are clean. Wave 13 plan
  // upgrades/downgrades take care of `plan` writes through the billing
  // lib (Teammate 2); we only handle the deletion fallback here.
  if (event.type === "customer.subscription.deleted") {
    update.plan = "pay_as_you_go";
    update.platform_fee_percentage = 0.10;
    update.stripe_subscription_id = null;
  }

  const { error: updErr } = await supabaseAdmin
    .from("profiles")
    .update(update)
    .eq("id", profile.id);
  if (updErr) {
    console.error(
      `[stripe.webhook] failed to update profile ${profile.id} from subscription event ${event.type}: ${updErr.message}`
    );
    return;
  }

  await logEvent({
    eventType:
      event.type === "customer.subscription.deleted"
        ? "subscription.deleted"
        : "subscription.updated",
    entityType: "profile",
    entityId: profile.id,
    payload: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_subscription_status: sub.status,
      previous_plan: profile.plan,
      previous_platform_fee_percentage: Number(profile.platform_fee_percentage),
      next_plan: update.plan ?? profile.plan,
      next_platform_fee_percentage:
        update.platform_fee_percentage ?? Number(profile.platform_fee_percentage),
    },
  });
}

function mapStripeSubStatus(
  stripeStatus: Stripe.Subscription.Status,
  eventType: string
): "none" | "active" | "past_due" | "canceled" | "trialing" {
  if (eventType === "customer.subscription.deleted") return "none";
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
