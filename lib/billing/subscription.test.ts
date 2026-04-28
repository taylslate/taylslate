import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- Hoisted mocks (declared before the SUT import) -----
const { stripe, supabaseAdmin, profilesBuilder, getOrCreateStripeCustomer, logEvent } =
  vi.hoisted(() => {
    const builder = {
      _profileRow: null as Record<string, unknown> | null,
      _patches: [] as Record<string, unknown>[],
      select: vi.fn().mockReturnThis(),
      eq: vi.fn(function (this: typeof builder) {
        // Read path resolves with the current row; write path captures patch.
        return this;
      }),
      update: vi.fn(function (this: typeof builder, patch: Record<string, unknown>) {
        this._patches.push(patch);
        return this;
      }),
      single: vi.fn(async () => ({ data: builder._profileRow, error: null })),
      // Used by logEvent (insert -> select -> single). Provided here so the
      // events module's chain resolves cleanly without throwing.
      insert: vi.fn().mockReturnThis(),
    };
    return {
      stripe: {
        customers: { create: vi.fn() },
        subscriptions: {
          create: vi.fn(),
          retrieve: vi.fn(),
          update: vi.fn(),
        },
      },
      supabaseAdmin: { from: vi.fn(() => builder) },
      profilesBuilder: builder,
      getOrCreateStripeCustomer: vi.fn(),
      logEvent: vi.fn<(input: { eventType: string }) => Promise<null>>(async () => null),
    };
  });

vi.mock("@/lib/stripe/server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/stripe/customer", () => ({ getOrCreateStripeCustomer }));
vi.mock("@/lib/data/events", () => ({ logEvent }));

import {
  createSubscription,
  upgradeSubscription,
  downgradeToPayg,
  finalizeDowngrade,
  changeSeats,
  type BillingProfile,
} from "./subscription";

function paygProfile(overrides: Partial<BillingProfile> = {}): BillingProfile {
  return {
    id: "p_brand_1",
    email: "brand@example.com",
    plan: "pay_as_you_go",
    platform_fee_percentage: 0.10,
    seat_count: 1,
    subscription_status: "none",
    stripe_customer_id: "cus_existing",
    stripe_subscription_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  profilesBuilder._patches.length = 0;
  profilesBuilder._profileRow = null;
  getOrCreateStripeCustomer.mockResolvedValue("cus_existing");
});

describe("createSubscription", () => {
  it("creates a new Stripe subscription on Operator and writes plan/fee/status to the profile", async () => {
    stripe.subscriptions.create.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [] },
    });

    const { subscriptionId, profile } = await createSubscription({
      profile: paygProfile(),
      targetPlan: "operator",
    });

    expect(subscriptionId).toBe("sub_new");
    expect(profile.plan).toBe("operator");
    expect(profile.platform_fee_percentage).toBe(0.06);
    expect(profile.subscription_status).toBe("active");

    // Stripe call shape — Operator base, no extra seat item at default seat_count=1
    const call = stripe.subscriptions.create.mock.calls[0][0];
    expect(call.customer).toBe("cus_existing");
    expect(call.items).toHaveLength(1);
    expect(call.proration_behavior).toBe("create_prorations");

    // Profile patch persisted with the new fee%
    const patch = profilesBuilder._patches[0];
    expect(patch.plan).toBe("operator");
    expect(patch.platform_fee_percentage).toBe(0.06);
    expect(patch.stripe_subscription_id).toBe("sub_new");

    // Two domain events: customer.upgraded and customer.plan_changed
    expect(logEvent).toHaveBeenCalledTimes(2);
    const eventTypes = logEvent.mock.calls.map((c) => c[0].eventType);
    expect(eventTypes).toContain("customer.upgraded");
    expect(eventTypes).toContain("customer.plan_changed");
  });

  it("rejects if profile already has a subscription", async () => {
    await expect(
      createSubscription({
        profile: paygProfile({ stripe_subscription_id: "sub_existing" }),
        targetPlan: "operator",
      })
    ).rejects.toThrow(/already has a subscription/);
  });
});

describe("upgradeSubscription", () => {
  it("Operator → Agency updates fee to 4% immediately and prorates", async () => {
    const operatorProfile = paygProfile({
      plan: "operator",
      platform_fee_percentage: 0.06,
      subscription_status: "active",
      stripe_subscription_id: "sub_op",
    });

    stripe.subscriptions.retrieve.mockResolvedValueOnce({
      id: "sub_op",
      items: { data: [{ id: "si_op_base", price: { id: "price_op_base" } }] },
    });
    stripe.subscriptions.update.mockResolvedValueOnce({ id: "sub_op" });

    const { profile } = await upgradeSubscription({
      profile: operatorProfile,
      targetPlan: "agency",
    });

    expect(profile.plan).toBe("agency");
    expect(profile.platform_fee_percentage).toBe(0.04);

    const patch = profilesBuilder._patches[0];
    expect(patch.platform_fee_percentage).toBe(0.04);

    // Stripe update wipes existing items and adds the agency items
    const updateCall = stripe.subscriptions.update.mock.calls[0];
    expect(updateCall[0]).toBe("sub_op");
    expect(updateCall[1].proration_behavior).toBe("create_prorations");
    const items = updateCall[1].items;
    // First item is the deletion of the old one
    expect(items[0]).toEqual({ id: "si_op_base", deleted: true });
  });

  it("PAYG → Operator routes through createSubscription path", async () => {
    stripe.subscriptions.create.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [] },
    });

    const { profile } = await upgradeSubscription({
      profile: paygProfile(),
      targetPlan: "operator",
    });

    expect(profile.plan).toBe("operator");
    expect(stripe.subscriptions.create).toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("rejects same-plan upgrade", async () => {
    await expect(
      upgradeSubscription({
        profile: paygProfile({ plan: "operator" }),
        targetPlan: "operator",
      })
    ).rejects.toThrow(/already on operator/);
  });
});

describe("downgradeToPayg", () => {
  it("schedules cancellation at period end and DEFERS the fee change", async () => {
    const periodEnd = Math.floor(Date.UTC(2026, 4, 28) / 1000);
    stripe.subscriptions.update.mockResolvedValueOnce({
      id: "sub_op",
      cancel_at_period_end: true,
      current_period_end: periodEnd,
    });

    const { effectiveAt, profile } = await downgradeToPayg({
      profile: paygProfile({
        plan: "operator",
        platform_fee_percentage: 0.06,
        subscription_status: "active",
        stripe_subscription_id: "sub_op",
      }),
    });

    expect(effectiveAt).toBe(new Date(periodEnd * 1000).toISOString());
    // CRITICAL: fee % is NOT reverted yet — webhook does that via finalizeDowngrade
    expect(profile.plan).toBe("operator");
    expect(profile.platform_fee_percentage).toBe(0.06);
    // No profile patch was written (defer until webhook)
    expect(profilesBuilder._patches.length).toBe(0);

    // domain event recorded
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "customer.downgraded" })
    );

    const updateCall = stripe.subscriptions.update.mock.calls[0];
    expect(updateCall[1].cancel_at_period_end).toBe(true);
  });

  it("rejects downgrade from PAYG", async () => {
    await expect(
      downgradeToPayg({ profile: paygProfile() })
    ).rejects.toThrow(/already on pay_as_you_go/);
  });
});

describe("finalizeDowngrade", () => {
  it("reverts plan to PAYG, fee to 0.10, seats to 1, clears subscription id", async () => {
    profilesBuilder._profileRow = {
      id: "p_brand_1",
      email: "brand@example.com",
      plan: "operator",
      platform_fee_percentage: 0.06,
      seat_count: 3,
      subscription_status: "active",
      stripe_customer_id: "cus_existing",
      stripe_subscription_id: "sub_op",
    };

    const result = await finalizeDowngrade("p_brand_1");

    expect(result.plan).toBe("pay_as_you_go");
    expect(result.platform_fee_percentage).toBe(0.10);
    expect(result.seat_count).toBe(1);
    expect(result.subscription_status).toBe("canceled");
    expect(result.stripe_subscription_id).toBeNull();

    const patch = profilesBuilder._patches[0];
    expect(patch.platform_fee_percentage).toBe(0.10);
    expect(patch.stripe_subscription_id).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "customer.plan_changed" })
    );
  });

  it("is idempotent on already-PAYG profiles", async () => {
    profilesBuilder._profileRow = {
      id: "p_brand_1",
      email: "brand@example.com",
      plan: "pay_as_you_go",
      platform_fee_percentage: 0.10,
      seat_count: 1,
      subscription_status: "canceled",
      stripe_customer_id: "cus_existing",
      stripe_subscription_id: null,
    };

    await finalizeDowngrade("p_brand_1");
    expect(profilesBuilder._patches.length).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe("changeSeats", () => {
  it("adding a seat updates Stripe quantity and writes seat_count", async () => {
    const operator = paygProfile({
      plan: "operator",
      platform_fee_percentage: 0.06,
      subscription_status: "active",
      stripe_subscription_id: "sub_op",
      seat_count: 1,
    });
    stripe.subscriptions.retrieve.mockResolvedValueOnce({
      id: "sub_op",
      items: { data: [{ id: "si_op_base", price: { id: "price_op_base" } }] },
    });
    stripe.subscriptions.update.mockResolvedValueOnce({ id: "sub_op" });

    const { profile } = await changeSeats({ profile: operator, delta: 2 });

    expect(profile.seat_count).toBe(3);
    expect(profilesBuilder._patches[0]).toEqual({ seat_count: 3 });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "customer.seat_added" })
    );
  });

  it("rejects seat changes on PAYG", async () => {
    await expect(
      changeSeats({ profile: paygProfile(), delta: 1 })
    ).rejects.toThrow(/does not support additional seats/);
  });

  it("rejects dropping below 1 seat", async () => {
    const operator = paygProfile({
      plan: "operator",
      platform_fee_percentage: 0.06,
      subscription_status: "active",
      stripe_subscription_id: "sub_op",
      seat_count: 1,
    });
    await expect(
      changeSeats({ profile: operator, delta: -1 })
    ).rejects.toThrow(/cannot drop below 1/);
  });
});
