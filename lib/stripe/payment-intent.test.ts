import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Hoist all mocks BEFORE the module under test imports them. ----

const { stripe, supabaseAdmin, logEvent, supabaseTables } = vi.hoisted(() => {
  // Per-table query-builder factory. Each `from(table)` returns a fresh
  // builder so the tests can stage rows independently.
  const tables: Record<string, { row?: unknown; error?: unknown }> = {};
  function makeBuilder(table: string) {
    let inserted: unknown = null;
    const builder: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn((payload: unknown) => {
        inserted = payload;
        return builder;
      }),
      single: vi.fn().mockImplementation(async () => {
        if (table === "payments_insert") {
          return {
            data: { id: "pay_row_1" },
            error: null,
          };
        }
        return {
          data: tables[table]?.row ?? null,
          error: tables[table]?.error ?? null,
        };
      }),
      _inserted: () => inserted,
    };
    return builder;
  }
  const builders: Record<string, ReturnType<typeof makeBuilder>> = {};
  return {
    stripe: {
      customers: { retrieve: vi.fn() },
      paymentIntents: { create: vi.fn() },
    },
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        // For payments writes we want a separate builder so insert/select/single
        // returns the payment row, not the deal row.
        const key = table === "payments" ? "payments_insert" : table;
        builders[key] = makeBuilder(key);
        return builders[key];
      }),
      _builders: builders,
    },
    logEvent: vi.fn().mockResolvedValue(null),
    supabaseTables: tables,
  };
});

vi.mock("./server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/events", () => ({ logEvent }));

import {
  computeApplicationFeeCents,
  chargeForEpisode,
} from "./payment-intent";

describe("computeApplicationFeeCents", () => {
  it("computes 10% of $250 (PAYG default) correctly", () => {
    expect(computeApplicationFeeCents(25000, 0.10)).toBe(2500);
  });

  it("computes 6% of $250 (Operator) correctly", () => {
    expect(computeApplicationFeeCents(25000, 0.06)).toBe(1500);
  });

  it("computes 4% of $250 (Agency) correctly", () => {
    expect(computeApplicationFeeCents(25000, 0.04)).toBe(1000);
  });

  it("rounds half up at the cent boundary so Taylslate is not silently underpaid", () => {
    // $1.005 at 10% = 0.1005 cents → rounds to 1
    expect(computeApplicationFeeCents(101, 0.10)).toBe(10);
    // $99.99 at 6% = 599.94 cents → rounds to 600
    expect(computeApplicationFeeCents(9999, 0.06)).toBe(600);
  });

  it("handles 0% (theoretical agency cap-edge) without exploding", () => {
    expect(computeApplicationFeeCents(50000, 0)).toBe(0);
  });

  it("handles 100% (theoretical) without exploding", () => {
    expect(computeApplicationFeeCents(50000, 1)).toBe(50000);
  });

  it("rejects negative amounts", () => {
    expect(() => computeApplicationFeeCents(-1, 0.10)).toThrow();
  });

  it("rejects fee percentages outside [0, 1]", () => {
    expect(() => computeApplicationFeeCents(100, -0.01)).toThrow();
    expect(() => computeApplicationFeeCents(100, 1.01)).toThrow();
  });

  it("rejects non-finite inputs", () => {
    expect(() => computeApplicationFeeCents(Number.NaN, 0.10)).toThrow();
    expect(() => computeApplicationFeeCents(100, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("chargeForEpisode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset hoisted builder map
    for (const k of Object.keys(supabaseAdmin._builders)) delete supabaseAdmin._builders[k];
    // Reset row staging
    for (const k of Object.keys(supabaseTables)) delete supabaseTables[k];

    supabaseTables.deals = {
      row: {
        id: "deal_1",
        brand_id: "user_brand_1",
        brand_profile_id: null,
      },
      error: null,
    };
    supabaseTables.io_line_items = {
      row: { id: "li_1", gross_rate: "250.00" },
      error: null,
    };
    supabaseTables.profiles = {
      row: {
        id: "user_brand_1",
        email: "brand@example.com",
        stripe_customer_id: "cus_brand_1",
        platform_fee_percentage: "0.10",
      },
      error: null,
    };

    stripe.customers.retrieve.mockResolvedValue({
      id: "cus_brand_1",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_test_1",
      status: "succeeded",
      amount: 25000,
    });
  });

  it("computes application_fee_amount from the brand's CURRENT platform_fee_percentage and snapshots it onto the payments row", async () => {
    const result = await chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" });

    // Stripe was called with the right shape — the load-bearing assertion.
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [createArg, createOpts] = stripe.paymentIntents.create.mock.calls[0];
    expect(createArg).toMatchObject({
      amount: 25000,
      currency: "usd",
      customer: "cus_brand_1",
      payment_method: "pm_card_visa",
      off_session: true,
      confirm: true,
      application_fee_amount: 2500,
    });
    expect(createArg.metadata).toMatchObject({
      deal_id: "deal_1",
      io_line_item_id: "li_1",
      platform_fee_percentage_at_charge: "0.1",
    });
    // Idempotency key collapses retries on (deal_id, io_line_item_id).
    expect(createOpts).toMatchObject({ idempotencyKey: "pi:deal_1:li_1" });

    // payments row carries the snapshot.
    const paymentsBuilder = supabaseAdmin._builders.payments_insert;
    expect(paymentsBuilder._inserted()).toMatchObject({
      deal_id: "deal_1",
      io_line_item_id: "li_1",
      stripe_payment_intent_id: "pi_test_1",
      amount_charged_cents: 25000,
      application_fee_amount_cents: 2500,
      platform_fee_percentage_at_charge: 0.10,
      status: "succeeded",
    });

    expect(result).toMatchObject({
      paymentId: "pay_row_1",
      stripePaymentIntentId: "pi_test_1",
      amountChargedCents: 25000,
      applicationFeeAmountCents: 2500,
      platformFeePercentageAtCharge: 0.10,
      status: "succeeded",
    });

    // Domain event fired.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "payment.charged", entityType: "payment" })
    );
  });

  it("uses the brand's Operator rate (6%) when platform_fee_percentage = 0.06", async () => {
    supabaseTables.profiles.row = {
      id: "user_brand_1",
      email: "brand@example.com",
      stripe_customer_id: "cus_brand_1",
      platform_fee_percentage: "0.06",
    };

    await chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" });

    const [createArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(createArg.application_fee_amount).toBe(1500);
    const paymentsBuilder = supabaseAdmin._builders.payments_insert;
    expect(paymentsBuilder._inserted()).toMatchObject({
      application_fee_amount_cents: 1500,
      platform_fee_percentage_at_charge: 0.06,
    });
  });

  it("refuses to charge when the brand has no saved payment method", async () => {
    stripe.customers.retrieve.mockResolvedValueOnce({
      id: "cus_brand_1",
      invoice_settings: { default_payment_method: null },
    });

    await expect(
      chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" })
    ).rejects.toThrow(/no default payment method/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("refuses to charge when the brand profile has no stripe_customer_id", async () => {
    supabaseTables.profiles.row = {
      id: "user_brand_1",
      email: "brand@example.com",
      stripe_customer_id: null,
      platform_fee_percentage: "0.10",
    };

    await expect(
      chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" })
    ).rejects.toThrow(/no stripe_customer_id/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});
