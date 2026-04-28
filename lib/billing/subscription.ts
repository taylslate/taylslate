// Wave 13 — Subscription lifecycle helpers.
//
// Wraps Stripe Subscription primitives so callers (API routes, webhook
// handler, billing UI server actions) work in plan-shaped concepts:
//   createSubscription, upgradeSubscription, downgradeToPayg,
//   addSeat, removeSeat, finalizeDowngrade.
//
// Conventions:
//   * Never hardcode a fee percentage — read from PLANS in lib/billing/plans.ts.
//   * `upgradeSubscription` writes plan/fee to the profile immediately.
//     Downgrades schedule cancellation at period end and DEFER the fee
//     change until Teammate 1's customer.subscription.deleted webhook
//     calls `finalizeDowngrade`.
//   * Every transition logs a domain event (entity_type=customer).
//   * Errors throw with descriptive messages — callers map to HTTP status.

import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getOrCreateStripeCustomer,
  type StripeCustomerProfileInput,
} from "@/lib/stripe/customer";
import { logEvent } from "@/lib/data/events";
import {
  getPlan,
  getPlanForFeePercentage,
  PLANS,
  type PlanId,
} from "./plans";
import { getPriceMap } from "./constants";

/** Profile fields the subscription helpers read/write. */
export interface BillingProfile extends StripeCustomerProfileInput {
  plan: PlanId;
  platform_fee_percentage: number;
  seat_count: number;
  subscription_status:
    | "none"
    | "active"
    | "past_due"
    | "canceled"
    | "trialing";
  stripe_subscription_id?: string | null;
}

/** Snapshot of billing-relevant profile fields for domain-event payloads. */
function snapshot(profile: BillingProfile) {
  return {
    plan: profile.plan,
    platform_fee_percentage: profile.platform_fee_percentage,
    seat_count: profile.seat_count,
    subscription_status: profile.subscription_status,
    stripe_subscription_id: profile.stripe_subscription_id ?? null,
  };
}

async function fetchBillingProfile(profileId: string): Promise<BillingProfile> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, email, full_name, company_name, stripe_customer_id, stripe_subscription_id, plan, platform_fee_percentage, seat_count, subscription_status"
    )
    .eq("id", profileId)
    .single();
  if (error || !data) {
    throw new Error(
      `Profile ${profileId} not found: ${error?.message ?? "no row"}`
    );
  }
  return data as BillingProfile;
}

async function persistProfile(
  profileId: string,
  patch: Partial<BillingProfile>
) {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update(patch)
    .eq("id", profileId);
  if (error) {
    throw new Error(
      `Failed to persist profile ${profileId} changes: ${error.message}`
    );
  }
}

// Stripe's TS types for Subscription don't currently expose every property
// we read (e.g. current_period_end). Index access keeps the call sites lean
// without forcing `as any` everywhere.
type SubscriptionWithFlags = Stripe.Subscription & {
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
};

/** Pricing items for a paid plan: base + (extra seats × seat price). */
function buildSubscriptionItems(
  plan: PlanId,
  seatCount: number
): Stripe.SubscriptionCreateParams.Item[] {
  if (plan === "pay_as_you_go") {
    throw new Error("pay_as_you_go has no subscription items");
  }
  const planRecord = getPlan(plan);
  if (seatCount < 1) {
    throw new Error("seat_count must be >= 1");
  }
  const prices = getPriceMap();
  const baseId = plan === "operator" ? prices.operatorBase : prices.agencyBase;
  const seatId = plan === "operator" ? prices.operatorSeat : prices.agencySeat;

  const items: Stripe.SubscriptionCreateParams.Item[] = [
    { price: baseId, quantity: 1 },
  ];
  const extraSeats = seatCount - planRecord.seatsIncluded;
  if (extraSeats > 0) {
    items.push({ price: seatId, quantity: extraSeats });
  }
  return items;
}

interface CreateSubscriptionInput {
  profile: BillingProfile;
  targetPlan: Exclude<PlanId, "pay_as_you_go">;
  seatCount?: number;
  actorId?: string | null;
}

/**
 * Materialise a brand-new Stripe Subscription for a profile that does not
 * have one yet. Sets the profile's plan, fee %, seat count, and
 * subscription_status to active immediately on success.
 */
export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<{ subscriptionId: string; profile: BillingProfile }> {
  const { profile, targetPlan } = input;
  const seatCount = input.seatCount ?? Math.max(profile.seat_count, 1);

  if (profile.stripe_subscription_id) {
    throw new Error(
      `Profile ${profile.id} already has a subscription (${profile.stripe_subscription_id}); use upgradeSubscription instead`
    );
  }

  const customerId = await getOrCreateStripeCustomer(profile);
  const items = buildSubscriptionItems(targetPlan, seatCount);

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items,
    proration_behavior: "create_prorations",
    metadata: {
      profile_id: profile.id,
      taylslate_plan: targetPlan,
    },
  });

  const before = snapshot(profile);
  const planRecord = getPlan(targetPlan);
  const after: BillingProfile = {
    ...profile,
    plan: targetPlan,
    platform_fee_percentage: planRecord.feePercentage,
    seat_count: seatCount,
    subscription_status: "active",
    stripe_subscription_id: subscription.id,
  };

  await persistProfile(profile.id, {
    plan: after.plan,
    platform_fee_percentage: after.platform_fee_percentage,
    seat_count: after.seat_count,
    subscription_status: after.subscription_status,
    stripe_subscription_id: after.stripe_subscription_id,
  });

  await logEvent({
    eventType: "customer.upgraded",
    entityType: "customer",
    entityId: profile.id,
    actorId: input.actorId ?? null,
    payload: { before, after: snapshot(after), source: "create" },
  });
  await logEvent({
    eventType: "customer.plan_changed",
    entityType: "customer",
    entityId: profile.id,
    actorId: input.actorId ?? null,
    payload: { before, after: snapshot(after), source: "create" },
  });

  return { subscriptionId: subscription.id, profile: after };
}

interface UpgradeSubscriptionInput {
  profile: BillingProfile;
  targetPlan: Exclude<PlanId, "pay_as_you_go">;
  actorId?: string | null;
}

/**
 * Move a profile from one paid plan to another (or from PAYG to a paid plan
 * — that path delegates to createSubscription). Plan + fee % are updated
 * on the profile *immediately*; Stripe handles proration mid-cycle via
 * `proration_behavior: 'create_prorations'`.
 */
export async function upgradeSubscription(
  input: UpgradeSubscriptionInput
): Promise<{ subscriptionId: string; profile: BillingProfile }> {
  const { profile, targetPlan } = input;

  if (profile.plan === targetPlan) {
    throw new Error(`Profile ${profile.id} is already on ${targetPlan}`);
  }

  if (!profile.stripe_subscription_id) {
    return createSubscription({
      profile,
      targetPlan,
      seatCount: profile.seat_count,
      actorId: input.actorId ?? null,
    });
  }

  const subscription = (await stripe.subscriptions.retrieve(
    profile.stripe_subscription_id
  )) as SubscriptionWithFlags;

  const targetSeats = Math.max(profile.seat_count, getPlan(targetPlan).seatsIncluded);
  const newItems = buildSubscriptionItems(targetPlan, targetSeats);

  // Stripe wants existing items removed (deleted: true) and the new ones
  // added in one update. Map by current item id.
  const updateItems: Stripe.SubscriptionUpdateParams.Item[] = [];
  for (const item of subscription.items.data) {
    updateItems.push({ id: item.id, deleted: true });
  }
  for (const item of newItems) {
    updateItems.push(item);
  }

  const updated = await stripe.subscriptions.update(
    profile.stripe_subscription_id,
    {
      items: updateItems,
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: {
        profile_id: profile.id,
        taylslate_plan: targetPlan,
      },
    }
  );

  const before = snapshot(profile);
  const planRecord = getPlan(targetPlan);
  const after: BillingProfile = {
    ...profile,
    plan: targetPlan,
    platform_fee_percentage: planRecord.feePercentage,
    seat_count: targetSeats,
    subscription_status: "active",
    stripe_subscription_id: updated.id,
  };

  await persistProfile(profile.id, {
    plan: after.plan,
    platform_fee_percentage: after.platform_fee_percentage,
    seat_count: after.seat_count,
    subscription_status: after.subscription_status,
    stripe_subscription_id: after.stripe_subscription_id,
  });

  await logEvent({
    eventType: "customer.upgraded",
    entityType: "customer",
    entityId: profile.id,
    actorId: input.actorId ?? null,
    payload: { before, after: snapshot(after), source: "upgrade" },
  });
  await logEvent({
    eventType: "customer.plan_changed",
    entityType: "customer",
    entityId: profile.id,
    actorId: input.actorId ?? null,
    payload: { before, after: snapshot(after), source: "upgrade" },
  });

  return { subscriptionId: updated.id, profile: after };
}

interface DowngradeInput {
  profile: BillingProfile;
  actorId?: string | null;
}

/**
 * Schedule the existing subscription for cancellation at the end of the
 * current billing period. Does NOT revert plan or fee % yet — Teammate 1's
 * webhook calls finalizeDowngrade once Stripe confirms the cancellation.
 *
 * Returns the period-end timestamp (ISO string) so callers can show the
 * customer when their downgrade takes effect.
 */
export async function downgradeToPayg(
  input: DowngradeInput
): Promise<{ effectiveAt: string | null; profile: BillingProfile }> {
  const { profile } = input;

  if (profile.plan === "pay_as_you_go") {
    throw new Error(`Profile ${profile.id} is already on pay_as_you_go`);
  }
  if (!profile.stripe_subscription_id) {
    // No active subscription to wind down. Treat as immediate downgrade.
    const before = snapshot(profile);
    const after = await finalizeDowngrade(profile.id);
    await logEvent({
      eventType: "customer.downgraded",
      entityType: "customer",
      entityId: profile.id,
      actorId: input.actorId ?? null,
      payload: { before, after: snapshot(after), source: "no_subscription" },
    });
    return { effectiveAt: null, profile: after };
  }

  const updated = (await stripe.subscriptions.update(
    profile.stripe_subscription_id,
    {
      cancel_at_period_end: true,
      metadata: {
        profile_id: profile.id,
        taylslate_pending_plan: "pay_as_you_go",
      },
    }
  )) as SubscriptionWithFlags;

  const periodEnd = updated.current_period_end ?? null;
  const effectiveAt = periodEnd
    ? new Date(periodEnd * 1000).toISOString()
    : null;

  const before = snapshot(profile);
  // Plan + fee unchanged. Subscription_status moves to canceled-at-period-end
  // is implicit in stripe — we keep our own status as 'active' until the
  // webhook fires `customer.subscription.deleted`.
  const after = profile;

  await logEvent({
    eventType: "customer.downgraded",
    entityType: "customer",
    entityId: profile.id,
    actorId: input.actorId ?? null,
    payload: {
      before,
      after: snapshot(after),
      effective_at: effectiveAt,
      source: "scheduled_period_end",
    },
  });

  return { effectiveAt, profile: after };
}

/**
 * Called by Teammate 1's `customer.subscription.deleted` webhook handler
 * (and by downgradeToPayg when there is no Stripe subscription to cancel).
 * Reverts the profile to PAYG: plan='pay_as_you_go', fee=0.10, seats=1,
 * clears stripe_subscription_id, sets subscription_status='canceled'.
 *
 * Idempotent — safe to call repeatedly with the same profile id.
 */
export async function finalizeDowngrade(
  profileId: string
): Promise<BillingProfile> {
  const profile = await fetchBillingProfile(profileId);

  if (profile.plan === "pay_as_you_go" && !profile.stripe_subscription_id) {
    return profile;
  }

  const before = snapshot(profile);
  const paygFee = PLANS.pay_as_you_go.feePercentage;

  await persistProfile(profileId, {
    plan: "pay_as_you_go",
    platform_fee_percentage: paygFee,
    seat_count: 1,
    subscription_status: "canceled",
    stripe_subscription_id: null,
  });

  const after: BillingProfile = {
    ...profile,
    plan: "pay_as_you_go",
    platform_fee_percentage: paygFee,
    seat_count: 1,
    subscription_status: "canceled",
    stripe_subscription_id: null,
  };

  await logEvent({
    eventType: "customer.plan_changed",
    entityType: "customer",
    entityId: profileId,
    payload: { before, after: snapshot(after), source: "finalize_downgrade" },
  });

  return after;
}

interface SeatChangeInput {
  profile: BillingProfile;
  delta: number;
  actorId?: string | null;
}

/**
 * Adjust seat count by `delta` (+ or -). Updates the Stripe Subscription
 * quantity on the seat add-on Price and persists `seat_count` on the
 * profile. Validates seat_count never drops below 1 and that the customer
 * is on a paid plan (PAYG seats are conceptually fixed at 1).
 */
export async function changeSeats(
  input: SeatChangeInput
): Promise<{ profile: BillingProfile }> {
  const { profile, delta } = input;
  if (delta === 0) {
    return { profile };
  }
  if (profile.plan === "pay_as_you_go") {
    throw new Error("Pay-as-you-go does not support additional seats");
  }
  if (!profile.stripe_subscription_id) {
    throw new Error(
      `Profile ${profile.id} is on ${profile.plan} but has no stripe_subscription_id`
    );
  }

  const newSeatCount = profile.seat_count + delta;
  if (newSeatCount < 1) {
    throw new Error("seat_count cannot drop below 1");
  }

  const planRecord = getPlan(profile.plan);
  const prices = getPriceMap();
  const seatPriceId =
    profile.plan === "operator" ? prices.operatorSeat : prices.agencySeat;
  const newExtraSeats = Math.max(newSeatCount - planRecord.seatsIncluded, 0);

  const subscription = await stripe.subscriptions.retrieve(
    profile.stripe_subscription_id
  );

  const existingSeatItem = subscription.items.data.find(
    (item) => item.price.id === seatPriceId
  );

  const updateItems: Stripe.SubscriptionUpdateParams.Item[] = [];
  if (existingSeatItem) {
    if (newExtraSeats === 0) {
      updateItems.push({ id: existingSeatItem.id, deleted: true });
    } else {
      updateItems.push({ id: existingSeatItem.id, quantity: newExtraSeats });
    }
  } else if (newExtraSeats > 0) {
    updateItems.push({ price: seatPriceId, quantity: newExtraSeats });
  }

  if (updateItems.length > 0) {
    await stripe.subscriptions.update(profile.stripe_subscription_id, {
      items: updateItems,
      proration_behavior: "create_prorations",
    });
  }

  const before = snapshot(profile);
  const after: BillingProfile = { ...profile, seat_count: newSeatCount };

  await persistProfile(profile.id, { seat_count: newSeatCount });

  await logEvent({
    eventType: delta > 0 ? "customer.seat_added" : "customer.seat_removed",
    entityType: "customer",
    entityId: profile.id,
    actorId: input.actorId ?? null,
    payload: { before, after: snapshot(after), delta },
  });

  return { profile: after };
}

/** Convenience wrappers preserving the spec's API surface. */
export function addSeat(
  profile: BillingProfile,
  count = 1,
  actorId?: string | null
) {
  return changeSeats({ profile, delta: Math.abs(count), actorId });
}
export function removeSeat(
  profile: BillingProfile,
  count = 1,
  actorId?: string | null
) {
  return changeSeats({ profile, delta: -Math.abs(count), actorId });
}

/**
 * API-route entry point — fetches the profile from the DB, runs the
 * upgrade, returns the updated profile. Validates the transition.
 */
export async function upgradeByProfileId(
  profileId: string,
  targetPlan: Exclude<PlanId, "pay_as_you_go">,
  actorId?: string | null
) {
  const profile = await fetchBillingProfile(profileId);
  // Only PAYG → Operator → Agency forward steps allowed via this entry.
  // Same-plan calls and Operator → Operator are handled by upgradeSubscription's
  // own validation; here we just block obviously-wrong transitions.
  if (profile.plan === targetPlan) {
    throw new Error(`Already on ${targetPlan}`);
  }
  return upgradeSubscription({ profile, targetPlan, actorId });
}

export async function downgradeByProfileId(
  profileId: string,
  actorId?: string | null
) {
  const profile = await fetchBillingProfile(profileId);
  return downgradeToPayg({ profile, actorId });
}

export async function changeSeatsByProfileId(
  profileId: string,
  delta: number,
  actorId?: string | null
) {
  const profile = await fetchBillingProfile(profileId);
  return changeSeats({ profile, delta, actorId });
}

/**
 * Reconcile a profile's plan/fee from the latest fee % when we only know
 * the percentage (e.g. webhook fallback). Used by Teammate 1 when their
 * handler can't tell which plan a subscription corresponds to.
 */
export function inferPlanFromFee(pct: number): PlanId {
  return getPlanForFeePercentage(pct)?.id ?? "pay_as_you_go";
}
