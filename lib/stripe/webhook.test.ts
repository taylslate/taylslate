import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockQueryBuilder {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  _stage: (row: unknown, error?: unknown) => void;
  _updated: () => unknown;
}

const { stripe, supabaseAdmin, logEvent, finalizeDowngrade, transferPayoutForPayment } = vi.hoisted(() => {
  const builders: Record<string, MockQueryBuilder> = {};
  function makeBuilder(): MockQueryBuilder {
    let updated: unknown = null;
    let returned: { row?: unknown; error?: unknown } = { row: null, error: null };
    // .eq must be (1) chainable for .select().eq().single() and (2) awaitable
    // for terminal UPDATE-then-eq calls (e.g. deals UPDATE with no .select()).
    // We make it a thenable that ALSO returns the builder for chaining.
    const builder: MockQueryBuilder = {
      update: vi.fn((payload: unknown) => {
        updated = payload;
        return builder;
      }),
      eq: vi.fn().mockImplementation(function eqImpl() {
        const result: Record<string, unknown> = { ...builder };
        // Awaitable terminus for UPDATEs.
        result.then = (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onFulfilled);
        return result;
      }),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(async () => ({
        data: returned.row ?? null,
        error: returned.error ?? null,
      })),
      _stage: (row: unknown, error: unknown = null) => {
        returned = { row, error };
      },
      _updated: () => updated,
    };
    return builder;
  }
  return {
    stripe: {
      webhooks: { constructEvent: vi.fn() },
    },
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        if (!builders[table]) builders[table] = makeBuilder();
        return builders[table];
      }),
      _builders: builders,
    },
    logEvent: vi.fn().mockResolvedValue(null),
    finalizeDowngrade: vi.fn().mockResolvedValue({
      id: "prof_1",
      plan: "pay_as_you_go",
      platform_fee_percentage: 0.10,
      seat_count: 1,
      subscription_status: "canceled",
      stripe_subscription_id: null,
    }),
    transferPayoutForPayment: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/events", () => ({ logEvent }));
vi.mock("@/lib/billing/subscription", () => ({ finalizeDowngrade }));
vi.mock("@/lib/payouts/transfer", () => ({ transferPayoutForPayment }));

import { verifyAndHandleStripeEvent, HANDLED_STRIPE_EVENTS } from "./webhook";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(supabaseAdmin._builders)) delete supabaseAdmin._builders[k];
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  finalizeDowngrade.mockResolvedValue({
    id: "prof_1",
    plan: "pay_as_you_go",
    platform_fee_percentage: 0.10,
    seat_count: 1,
    subscription_status: "canceled",
    stripe_subscription_id: null,
  });
  transferPayoutForPayment.mockResolvedValue(undefined);
});

describe("verifyAndHandleStripeEvent — verification", () => {
  it("throws when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await expect(
      verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "t=1,v1=abc" })
    ).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("throws when stripe-signature header is missing", async () => {
    await expect(
      verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: null })
    ).rejects.toThrow(/stripe-signature/);
  });

  it("propagates the SDK signature error so the route returns 400", async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    await expect(
      verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "t=1,v1=bad" })
    ).rejects.toThrow(/Invalid signature/);
  });

  it("calls constructEvent with the raw body, header, and secret", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_unhandled",
      type: "some.unknown.event",
      data: { object: {} },
    });
    const result = await verifyAndHandleStripeEvent({
      rawBody: "RAWBODY",
      signatureHeader: "t=1,v1=ok",
    });
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      "RAWBODY",
      "t=1,v1=ok",
      "whsec_test"
    );
    expect(result).toMatchObject({ eventId: "evt_unhandled", handled: false });
  });
});

describe("verifyAndHandleStripeEvent — handlers", () => {
  it("setup_intent.succeeded persists payment_method_id onto the deal and fires deal.payment_method_attached", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_si_ok",
      type: "setup_intent.succeeded",
      data: {
        object: {
          id: "seti_1",
          customer: "cus_brand_1",
          payment_method: "pm_card_1",
          metadata: { deal_id: "deal_si_1" },
        },
      },
    });
    supabaseAdmin._builders.deals = supabaseAdmin.from("deals");

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    expect(supabaseAdmin._builders.deals._updated()).toEqual({ payment_method_id: "pm_card_1" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "deal.payment_method_attached",
        entityType: "deal",
        entityId: "deal_si_1",
        payload: {
          setup_intent_id: "seti_1",
          payment_method_id: "pm_card_1",
          deal_id: "deal_si_1",
        },
      })
    );
  });

  it("setup_intent.succeeded with no metadata.deal_id is a no-op", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_si_no_deal",
      type: "setup_intent.succeeded",
      data: {
        object: { id: "seti_x", payment_method: "pm_x", metadata: {} },
      },
    });

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    // No deals row touched, no event fired.
    expect(supabaseAdmin._builders.deals).toBeUndefined();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("payment_intent.succeeded flips status to succeeded and fires payment.charged", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_pi_ok",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", status: "succeeded" } },
    });
    supabaseAdmin._builders.payments = supabaseAdmin.from("payments");
    supabaseAdmin._builders.payments._stage({
      id: "pay_1",
      deal_id: "deal_1",
      io_line_item_id: "li_1",
    });

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    expect(supabaseAdmin._builders.payments._updated()).toEqual({ status: "succeeded" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "payment.charged" })
    );
  });

  it("payment_intent.payment_failed flips status to failed and fires payment.failed", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_pi_fail",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_2",
          last_payment_error: { code: "card_declined", message: "Your card was declined." },
        },
      },
    });
    supabaseAdmin._builders.payments = supabaseAdmin.from("payments");
    supabaseAdmin._builders.payments._stage({
      id: "pay_2",
      deal_id: "deal_2",
      io_line_item_id: "li_2",
    });

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    expect(supabaseAdmin._builders.payments._updated()).toEqual({ status: "failed" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payment.failed",
        payload: expect.objectContaining({ stripe_error_code: "card_declined" }),
      })
    );
  });

  it("charge.succeeded sets settled_at, fires payment.settled, and triggers the show payout", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_charge_ok",
      type: "charge.succeeded",
      data: {
        object: { id: "ch_1", payment_intent: "pi_3" },
      },
    });
    supabaseAdmin._builders.payments = supabaseAdmin.from("payments");
    supabaseAdmin._builders.payments._stage({
      id: "pay_3",
      deal_id: "deal_3",
      io_line_item_id: "li_3",
    });

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    const updated = supabaseAdmin._builders.payments._updated() as Record<string, string>;
    expect(updated.settled_at).toBeTypeOf("string");
    expect(Number.isFinite(Date.parse(updated.settled_at))).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "payment.settled" })
    );
    // Payout fires AFTER settled_at is set, with the payment row id.
    expect(transferPayoutForPayment).toHaveBeenCalledWith("pay_3");
    expect(transferPayoutForPayment).toHaveBeenCalledTimes(1);
  });

  it("charge.succeeded payout failure does NOT break the webhook ack (fail-soft)", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_charge_payout_err",
      type: "charge.succeeded",
      data: {
        object: { id: "ch_2", payment_intent: "pi_payout_err" },
      },
    });
    supabaseAdmin._builders.payments = supabaseAdmin.from("payments");
    supabaseAdmin._builders.payments._stage({
      id: "pay_pout_err",
      deal_id: "deal_x",
      io_line_item_id: "li_x",
    });
    transferPayoutForPayment.mockRejectedValueOnce(new Error("connect account not ready"));

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    // Settlement is recorded, payout attempted, but the handler returns
    // handled=true so Stripe won't redeliver and re-flip settled_at.
    expect(r.handled).toBe(true);
    expect(transferPayoutForPayment).toHaveBeenCalledWith("pay_pout_err");
  });

  it("payout-gate invariant: payment_intent.succeeded does NOT set settled_at and does NOT trigger a payout", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_pi_only",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_4", status: "succeeded" } },
    });
    supabaseAdmin._builders.payments = supabaseAdmin.from("payments");
    supabaseAdmin._builders.payments._stage({
      id: "pay_4",
      deal_id: "deal_4",
      io_line_item_id: "li_4",
    });

    await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    const updated = supabaseAdmin._builders.payments._updated() as Record<string, unknown>;
    expect(updated).not.toHaveProperty("settled_at");
    expect(updated).toEqual({ status: "succeeded" });
    expect(transferPayoutForPayment).not.toHaveBeenCalled();
  });

  it("charge.dispute.created flips status to disputed and fires payment.disputed", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_dispute",
      type: "charge.dispute.created",
      data: {
        object: { id: "dp_1", payment_intent: "pi_5", reason: "fraudulent", amount: 25000 },
      },
    });
    supabaseAdmin._builders.payments = supabaseAdmin.from("payments");
    supabaseAdmin._builders.payments._stage({ id: "pay_5", deal_id: "deal_5" });

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    expect(supabaseAdmin._builders.payments._updated()).toEqual({ status: "disputed" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payment.disputed",
        payload: expect.objectContaining({ reason: "fraudulent", amount: 25000 }),
      })
    );
  });

  it("customer.subscription.deleted delegates to finalizeDowngrade — no inline plan/fee writes", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_sub_del",
      type: "customer.subscription.deleted",
      data: {
        object: { id: "sub_1", customer: "cus_1", status: "canceled" },
      },
    });
    supabaseAdmin._builders.profiles = supabaseAdmin.from("profiles");
    supabaseAdmin._builders.profiles._stage({
      id: "prof_1",
      plan: "operator",
      platform_fee_percentage: "0.06",
    });

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    // The webhook resolves the profile but does NOT write plan/fee/seat
    // inline — that's finalizeDowngrade's job. profiles.update should not be
    // called.
    expect(supabaseAdmin._builders.profiles._updated()).toBeNull();
    expect(finalizeDowngrade).toHaveBeenCalledWith("prof_1");
    expect(finalizeDowngrade).toHaveBeenCalledTimes(1);
  });

  it("customer.subscription.deleted swallows finalizeDowngrade errors so the webhook still acks", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_sub_del_err",
      type: "customer.subscription.deleted",
      data: {
        object: { id: "sub_err", customer: "cus_err", status: "canceled" },
      },
    });
    supabaseAdmin._builders.profiles = supabaseAdmin.from("profiles");
    supabaseAdmin._builders.profiles._stage({
      id: "prof_err",
      plan: "operator",
      platform_fee_percentage: "0.06",
    });
    finalizeDowngrade.mockRejectedValueOnce(new Error("transient db error"));

    const r = await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    expect(r.handled).toBe(true);
    expect(finalizeDowngrade).toHaveBeenCalledWith("prof_err");
  });

  it("customer.subscription.updated mirrors Stripe status without forcing a plan/fee change", async () => {
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_sub_upd",
      type: "customer.subscription.updated",
      data: {
        object: { id: "sub_2", customer: "cus_2", status: "past_due" },
      },
    });
    supabaseAdmin._builders.profiles = supabaseAdmin.from("profiles");
    supabaseAdmin._builders.profiles._stage({
      id: "prof_2",
      plan: "operator",
      platform_fee_percentage: "0.06",
    });

    await verifyAndHandleStripeEvent({ rawBody: "{}", signatureHeader: "sig" });
    const updated = supabaseAdmin._builders.profiles._updated() as Record<string, unknown>;
    expect(updated).toEqual({ subscription_status: "past_due" });
    // The update path must NEVER call finalizeDowngrade.
    expect(finalizeDowngrade).not.toHaveBeenCalled();
  });
});

describe("HANDLED_STRIPE_EVENTS", () => {
  it("exports the canonical event-type list for the webhook subscriber to register", () => {
    expect(HANDLED_STRIPE_EVENTS).toContain("setup_intent.succeeded");
    expect(HANDLED_STRIPE_EVENTS).toContain("payment_intent.succeeded");
    expect(HANDLED_STRIPE_EVENTS).toContain("payment_intent.payment_failed");
    expect(HANDLED_STRIPE_EVENTS).toContain("charge.succeeded");
    expect(HANDLED_STRIPE_EVENTS).toContain("charge.dispute.created");
    expect(HANDLED_STRIPE_EVENTS).toContain("customer.subscription.updated");
    expect(HANDLED_STRIPE_EVENTS).toContain("customer.subscription.deleted");
  });
});
