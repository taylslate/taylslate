import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Hoisted mocks ----
//
// We model supabaseAdmin as a per-table builder map so the test can stage
// rows for `payments`, `deals`, `show_profiles`, `profiles`, and
// `payouts` independently. Stripe is a thin object whose `transfers.create`
// is asserted against directly.

const { stripe, supabaseAdmin, supabaseTables, payoutInsertCapture, payoutUpdateCapture, builders } =
  vi.hoisted(() => {
    interface TableState {
      row?: unknown;
      error?: unknown;
      maybeRow?: unknown;
    }
    const tables: Record<string, TableState> = {};
    const builders: Record<string, ReturnType<typeof makeBuilder>> = {};
    const payoutInsertCapture: { value: unknown } = { value: null };
    const payoutUpdateCapture: { value: unknown } = { value: null };

    function makeBuilder(table: string) {
      const builder: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn((patch: unknown) => {
          if (table === "payouts") payoutUpdateCapture.value = patch;
          return builder;
        }),
        insert: vi.fn((payload: unknown) => {
          if (table === "payouts") payoutInsertCapture.value = payload;
          return builder;
        }),
        single: vi.fn().mockImplementation(async () => ({
          data: tables[table]?.row ?? null,
          error: tables[table]?.error ?? null,
        })),
        maybeSingle: vi.fn().mockImplementation(async () => ({
          data: tables[table]?.maybeRow ?? null,
          error: null,
        })),
      };
      return builder;
    }

    return {
      stripe: {
        transfers: { create: vi.fn() },
        paymentIntents: { retrieve: vi.fn() },
      },
      supabaseAdmin: {
        from: vi.fn((table: string) => {
          builders[table] = makeBuilder(table);
          return builders[table];
        }),
      },
      supabaseTables: tables,
      payoutInsertCapture,
      payoutUpdateCapture,
      builders,
    };
  });

vi.mock("@/lib/stripe/server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/events", () => ({ logEvent: vi.fn().mockResolvedValue(null) }));

import {
  transferPayoutForPayment,
  transferEarlyPayoutForPayment,
} from "./transfer";

function setPayment(row: Record<string, unknown>) {
  supabaseTables.payments = { row };
}
function setDeal(row: Record<string, unknown>) {
  supabaseTables.deals = { row };
}
function setShowProfile(row: Record<string, unknown>) {
  supabaseTables.show_profiles = { row };
}
function setProfile(row: Record<string, unknown>) {
  supabaseTables.profiles = { row };
}
function setExistingPayout(row: Record<string, unknown> | null) {
  supabaseTables.payouts = {
    maybeRow: row,
    row: { id: "po_persisted_1" },
  };
}

const SETTLED_AT = "2026-04-25T12:00:00Z";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(supabaseTables)) delete supabaseTables[k];
  payoutInsertCapture.value = null;
  payoutUpdateCapture.value = null;
  stripe.transfers.create.mockReset();
  stripe.transfers.create.mockResolvedValue({ id: "tr_test_123" });
  stripe.paymentIntents.retrieve.mockReset();
  stripe.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_test_1",
    latest_charge: "ch_test_1",
  });
});

describe("transferPayoutForPayment — settle gate (load-bearing financial invariant)", () => {
  it("returns null and DOES NOT call Stripe when settled_at IS NULL", async () => {
    setPayment({
      id: "pay_1",
      deal_id: "deal_1",
      io_line_item_id: "li_1",
      amount_charged_cents: 25000,
      application_fee_amount_cents: 2500,
      settled_at: null,
    });

    const result = await transferPayoutForPayment("pay_1");

    expect(result).toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("transfers the show net (amount_charged - application_fee) when settled, funded by the charge", async () => {
    setPayment({
      id: "pay_2",
      deal_id: "deal_2",
      io_line_item_id: "li_2",
      stripe_payment_intent_id: "pi_pay_2",
      amount_charged_cents: 25000, // $250 charged
      application_fee_amount_cents: 2500, // 10% PAYG
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setDeal({ id: "deal_2", show_profile_id: "sp_2" });
    setShowProfile({ id: "sp_2", user_id: "user_2" });
    setProfile({ id: "user_2", stripe_connect_account_id: "acct_show_2" });

    const result = await transferPayoutForPayment("pay_2");

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_pay_2");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    const [args, opts] = stripe.transfers.create.mock.calls[0];
    expect(args).toMatchObject({
      amount: 22500, // $225 net (25000 - 2500)
      currency: "usd",
      destination: "acct_show_2",
      // Funded by the brand's charge, never the platform balance.
      source_transaction: "ch_test_1",
      transfer_group: "deal_2",
    });
    expect(opts).toMatchObject({ idempotencyKey: "transfer:v2:pay_2" });
    expect(result).toEqual({
      payoutId: "po_persisted_1",
      stripeTransferId: "tr_test_123",
      amountCents: 22500,
    });
    expect(payoutInsertCapture.value).toMatchObject({
      payment_id: "pay_2",
      stripe_transfer_id: "tr_test_123",
      amount_cents: 22500,
      early_payout_fee_cents: 0,
    });
  });

  it("is idempotent — returns existing payout and skips Stripe when one already exists", async () => {
    setPayment({
      id: "pay_3",
      deal_id: "deal_3",
      io_line_item_id: "li_3",
      stripe_payment_intent_id: "pi_pay_3",
      amount_charged_cents: 25000,
      application_fee_amount_cents: 1500,
      settled_at: SETTLED_AT,
    });
    setExistingPayout({
      id: "po_existing",
      stripe_transfer_id: "tr_existing",
      amount_cents: 23500,
      transferred_at: SETTLED_AT,
    });

    const result = await transferPayoutForPayment("pay_3");

    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(result).toEqual({
      payoutId: "po_existing",
      stripeTransferId: "tr_existing",
      amountCents: 23500,
    });
  });

  it("throws when the show has no Stripe Connect account", async () => {
    setPayment({
      id: "pay_4",
      deal_id: "deal_4",
      io_line_item_id: "li_4",
      stripe_payment_intent_id: "pi_pay_4",
      amount_charged_cents: 10000,
      application_fee_amount_cents: 1000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setDeal({ id: "deal_4", show_profile_id: "sp_4" });
    setShowProfile({ id: "sp_4", user_id: "user_4" });
    setProfile({ id: "user_4", stripe_connect_account_id: null });

    await expect(transferPayoutForPayment("pay_4")).rejects.toThrow(
      /no stripe_connect_account_id/
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("throws when a settled payment has no stripe_payment_intent_id (source_transaction guard)", async () => {
    setPayment({
      id: "pay_5",
      deal_id: "deal_5",
      io_line_item_id: "li_5",
      stripe_payment_intent_id: null,
      amount_charged_cents: 10000,
      application_fee_amount_cents: 1000,
      settled_at: SETTLED_AT,
    });

    await expect(transferPayoutForPayment("pay_5")).rejects.toThrow(
      /no stripe_payment_intent_id/
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("throws when the PaymentIntent has no latest_charge — never transfers unfunded", async () => {
    setPayment({
      id: "pay_6",
      deal_id: "deal_6",
      io_line_item_id: "li_6",
      stripe_payment_intent_id: "pi_pay_6",
      amount_charged_cents: 10000,
      application_fee_amount_cents: 1000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setDeal({ id: "deal_6", show_profile_id: "sp_6" });
    setShowProfile({ id: "sp_6", user_id: "user_6" });
    setProfile({ id: "user_6", stripe_connect_account_id: "acct_6" });
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: "pi_pay_6",
      latest_charge: null,
    });

    await expect(transferPayoutForPayment("pay_6")).rejects.toThrow(
      /no latest_charge/
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("unwraps an expanded latest_charge object to its id", async () => {
    setPayment({
      id: "pay_7",
      deal_id: "deal_7",
      io_line_item_id: "li_7",
      stripe_payment_intent_id: "pi_pay_7",
      amount_charged_cents: 10000,
      application_fee_amount_cents: 1000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setDeal({ id: "deal_7", show_profile_id: "sp_7" });
    setShowProfile({ id: "sp_7", user_id: "user_7" });
    setProfile({ id: "user_7", stripe_connect_account_id: "acct_7" });
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: "pi_pay_7",
      latest_charge: { id: "ch_expanded_7" },
    });

    await transferPayoutForPayment("pay_7");

    const [args] = stripe.transfers.create.mock.calls[0];
    expect(args.source_transaction).toBe("ch_expanded_7");
  });
});

describe("transferEarlyPayoutForPayment — fee math + double-payout protection", () => {
  it("applies the 2.5% early-payout fee to the show net", async () => {
    setPayment({
      id: "pay_e1",
      deal_id: "deal_e1",
      io_line_item_id: "li_e1",
      stripe_payment_intent_id: "pi_pay_e1",
      amount_charged_cents: 25000, // $250 charged
      application_fee_amount_cents: 2500, // platform fee, 10%
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setDeal({ id: "deal_e1", show_profile_id: "sp_e1" });
    setShowProfile({ id: "sp_e1", user_id: "user_e1" });
    setProfile({ id: "user_e1", stripe_connect_account_id: "acct_e1" });

    const result = await transferEarlyPayoutForPayment("pay_e1", 0.025);

    // Show net = 25000 - 2500 = 22500
    // Early fee = round(22500 * 0.025) = 563
    // Transfer = 22500 - 563 = 21937
    const [args, opts] = stripe.transfers.create.mock.calls[0];
    expect(args.amount).toBe(21937);
    expect(args.source_transaction).toBe("ch_test_1");
    expect(opts).toMatchObject({ idempotencyKey: "transfer-early:v2:pay_e1" });
    expect(result.amountCents).toBe(21937);
    expect(payoutInsertCapture.value).toMatchObject({
      payment_id: "pay_e1",
      amount_cents: 21937,
      early_payout_fee_cents: 563,
    });
  });

  it("refuses early payout when an automatic payout already fired", async () => {
    setPayment({
      id: "pay_e2",
      deal_id: "deal_e2",
      io_line_item_id: "li_e2",
      stripe_payment_intent_id: "pi_pay_e2",
      amount_charged_cents: 25000,
      application_fee_amount_cents: 2500,
      settled_at: SETTLED_AT,
    });
    setExistingPayout({
      id: "po_auto",
      stripe_transfer_id: "tr_auto",
      amount_cents: 22500,
      transferred_at: SETTLED_AT,
    });

    await expect(
      transferEarlyPayoutForPayment("pay_e2", 0.025)
    ).rejects.toThrow(/already has a payout/);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("refuses when the payment hasn't settled", async () => {
    setPayment({
      id: "pay_e3",
      deal_id: "deal_e3",
      io_line_item_id: "li_e3",
      amount_charged_cents: 25000,
      application_fee_amount_cents: 2500,
      settled_at: null,
    });

    await expect(
      transferEarlyPayoutForPayment("pay_e3", 0.025)
    ).rejects.toThrow(/has not settled/);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("rejects out-of-range fee percentages", async () => {
    await expect(transferEarlyPayoutForPayment("x", 1.5)).rejects.toThrow(
      /feePercentage must be in/
    );
    await expect(transferEarlyPayoutForPayment("x", -0.01)).rejects.toThrow(
      /feePercentage must be in/
    );
  });
});
