import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Hoist all mocks BEFORE the module under test imports them. ----

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  _inserted: () => unknown;
}

const { stripe, supabaseAdmin, logEvent, supabaseTables } = vi.hoisted(() => {
  // Per-table query-builder factory. Each `from(table)` returns a fresh
  // builder so the tests can stage rows independently.
  //
  // The payments table has three distinct access shapes, staged under
  // separate keys:
  //   tables["payments:precheck"] — the existing-payment pre-check
  //     (…maybeSingle at the top of chargeForEpisode)
  //   tables["payments_insert"]   — the insert result (stage an error
  //     with code "23505" to simulate the unique-index collision)
  //   tables["payments:lookup"]   — the select-by-stripe_payment_intent_id
  //     replay lookup after a 23505
  const tables: Record<string, { row?: unknown; error?: unknown }> = {};
  function makeBuilder(table: string): MockQueryBuilder {
    let inserted: unknown = null;
    const builder: MockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn((payload: unknown) => {
        inserted = payload;
        return builder;
      }),
      maybeSingle: vi.fn().mockImplementation(async () => {
        const key = table === "payments_insert" ? "payments:precheck" : `${table}:maybe`;
        return {
          data: tables[key]?.row ?? null,
          error: tables[key]?.error ?? null,
        };
      }),
      single: vi.fn().mockImplementation(async () => {
        if (table === "payments_insert") {
          if (inserted !== null) {
            const staged = tables["payments_insert"];
            if (staged?.error) return { data: null, error: staged.error };
            return { data: staged?.row ?? { id: "pay_row_1" }, error: null };
          }
          // No insert on this builder → it's the 23505 replay lookup.
          return {
            data: tables["payments:lookup"]?.row ?? null,
            error: tables["payments:lookup"]?.error ?? null,
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
  const builders: Record<string, MockQueryBuilder> = {};
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
        payment_method_id: "pm_deal_card",
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

  it("computes the platform fee from the brand's CURRENT platform_fee_percentage and snapshots it onto the payments row — never onto the Stripe PI", async () => {
    const result = await chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" });

    // Stripe was called with the right shape — the load-bearing assertion.
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [createArg, createOpts] = stripe.paymentIntents.create.mock.calls[0];
    expect(createArg).toMatchObject({
      amount: 25000,
      currency: "usd",
      customer: "cus_brand_1",
      payment_method: "pm_deal_card",
      off_session: true,
      confirm: true,
    });
    // SEPARATE CHARGES & TRANSFERS: application_fee_amount is only legal
    // on direct/destination charges — Stripe rejects it on a
    // platform-account PI. The fee must NOT be in the create params.
    expect(createArg.application_fee_amount).toBeUndefined();
    expect(createArg.metadata).toMatchObject({
      deal_id: "deal_1",
      io_line_item_id: "li_1",
      platform_fee_percentage_at_charge: "0.1",
      application_fee_amount_cents: "2500",
    });
    // Idempotency key collapses retries on (deal_id, io_line_item_id).
    // v2: the v1 key shape carried application_fee_amount in its params.
    expect(createOpts).toMatchObject({ idempotencyKey: "pi:v2:deal_1:li_1" });

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
    expect(createArg.application_fee_amount).toBeUndefined();
    expect(createArg.metadata.application_fee_amount_cents).toBe("1500");
    const paymentsBuilder = supabaseAdmin._builders.payments_insert;
    expect(paymentsBuilder._inserted()).toMatchObject({
      application_fee_amount_cents: 1500,
      platform_fee_percentage_at_charge: 0.06,
    });
  });

  it("falls back to the customer default payment method for legacy/manual card flows", async () => {
    supabaseTables.deals.row = {
      id: "deal_1",
      brand_id: "user_brand_1",
      brand_profile_id: null,
      payment_method_id: null,
    };

    await chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" });

    expect(stripe.customers.retrieve).toHaveBeenCalledWith("cus_brand_1");
    const [createArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(createArg.payment_method).toBe("pm_card_visa");
  });

  it("refuses to charge when the deal and customer have no saved payment method", async () => {
    supabaseTables.deals.row = {
      id: "deal_1",
      brand_id: "user_brand_1",
      brand_profile_id: null,
      payment_method_id: null,
    };
    stripe.customers.retrieve.mockResolvedValueOnce({
      id: "cus_brand_1",
      invoice_settings: { default_payment_method: null },
    });

    await expect(
      chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" })
    ).rejects.toThrow(/no saved payment_method_id/);
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

  it("short-circuits on an existing non-failed payment without touching Stripe", async () => {
    supabaseTables["payments:precheck"] = {
      row: {
        id: "pay_prior",
        stripe_payment_intent_id: "pi_prior",
        amount_charged_cents: 25000,
        application_fee_amount_cents: 2500,
        platform_fee_percentage_at_charge: "0.10",
        status: "succeeded",
      },
    };

    const result = await chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" });

    expect(result).toEqual({
      paymentId: "pay_prior",
      stripePaymentIntentId: "pi_prior",
      amountChargedCents: 25000,
      applicationFeeAmountCents: 2500,
      platformFeePercentageAtCharge: 0.10,
      status: "succeeded",
    });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    // No state changed — no duplicate payment.charged event.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("fails closed (no Stripe call) when the existing-payment pre-check errors", async () => {
    supabaseTables["payments:precheck"] = { error: { message: "db down" } };

    await expect(
      chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" })
    ).rejects.toThrow(/Failed to check for an existing payment/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("treats a stripe_payment_intent_id unique-index collision (23505) as an idempotent replay", async () => {
    supabaseTables.payments_insert = {
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    };
    supabaseTables["payments:lookup"] = {
      row: {
        id: "pay_existing",
        stripe_payment_intent_id: "pi_test_1",
        amount_charged_cents: 25000,
        application_fee_amount_cents: 2500,
        platform_fee_percentage_at_charge: 0.10,
        status: "succeeded",
      },
    };

    const result = await chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" });

    expect(result).toMatchObject({
      paymentId: "pay_existing",
      stripePaymentIntentId: "pi_test_1",
      status: "succeeded",
    });
    // Replay path: the original call already logged payment.charged.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("still throws on a non-23505 persistence error", async () => {
    supabaseTables.payments_insert = {
      error: { code: "XX000", message: "boom" },
    };

    await expect(
      chargeForEpisode({ dealId: "deal_1", ioLineItemId: "li_1" })
    ).rejects.toThrow(/Failed to persist payments row/);
  });
});
