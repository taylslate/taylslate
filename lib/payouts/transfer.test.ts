import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Hoisted mocks ----
//
// We model supabaseAdmin as a per-table builder map so the test can stage
// rows for `payments`, `deals`, `show_profiles`, `profiles`, and
// `payouts` independently. Stripe is a thin object whose `transfers.create`
// is asserted against directly.

const { stripe, supabaseAdmin, supabaseTables, payoutInsertCapture, payoutUpdateCapture, builders, sendEmail, getAuthEmail } =
  vi.hoisted(() => {
    interface TableState {
      row?: unknown;
      error?: unknown;
      maybeRow?: unknown;
      rows?: unknown[];
      readError?: { code?: string; message?: string } | null;
      readThrow?: Error | null;
      insertError?: { code?: string; message?: string } | null;
      updateResult?: unknown;
      updateError?: { code?: string; message?: string } | null;
      reread?: unknown;
      selectReads?: number;
    }
    const tables: Record<string, TableState> = {};
    const builders: Record<string, ReturnType<typeof makeBuilder>> = {};
    const payoutInsertCapture: { value: unknown } = { value: null };
    const payoutUpdateCapture: { value: unknown } = { value: null };

    function makeBuilder(table: string) {
      let op: "select" | "insert" | "update" = "select";
      const builder: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        update: vi.fn((patch: unknown) => {
          op = "update";
          if (table === "payouts") payoutUpdateCapture.value = patch;
          return builder;
        }),
        insert: vi.fn((payload: unknown) => {
          op = "insert";
          if (table === "payouts") payoutInsertCapture.value = payload;
          return builder;
        }),
        single: vi.fn().mockImplementation(async () => {
          const state = tables[table] ?? {};
          if (table === "payouts" && op === "insert" && state.insertError) {
            return { data: null, error: state.insertError };
          }
          return { data: state.row ?? null, error: state.error ?? null };
        }),
        maybeSingle: vi.fn().mockImplementation(async () => {
          const state = tables[table] ?? {};
          if (table === "payouts" && op === "update") {
            if (state.updateError) return { data: null, error: state.updateError };
            return {
              data: state.updateResult === undefined ? (state.row ?? null) : state.updateResult,
              error: null,
            };
          }
          if (table === "payouts") {
            state.selectReads = (state.selectReads ?? 0) + 1;
            if (state.selectReads > 1 && "reread" in state) {
              return { data: state.reread, error: null };
            }
          }
          return { data: state.maybeRow ?? null, error: null };
        }),
        then(
          resolve: (value: { data: unknown; error: { code?: string; message?: string } | null }) => unknown,
          reject?: (err: unknown) => unknown
        ) {
          const state = tables[table] ?? {};
          if (state.readThrow) return Promise.reject(state.readThrow).then(resolve, reject);
          if (state.readError) {
            return Promise.resolve({ data: null, error: state.readError }).then(resolve, reject);
          }
          return Promise.resolve({ data: state.rows ?? [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    }

    return {
      stripe: {
        transfers: { create: vi.fn(), list: vi.fn() },
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
      sendEmail: vi.fn(),
      getAuthEmail: vi.fn(),
    };
  });

vi.mock("@/lib/stripe/server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/events", () => ({ logEvent: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/email/send", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock("@/lib/auth/auth-email", () => ({
  getAuthEmail: (...args: unknown[]) => getAuthEmail(...args),
}));

import { logEvent } from "@/lib/data/events";
import {
  transferPayoutForPayment,
  transferEarlyPayoutForPayment,
  PayoutHeldError,
  PayoutAlreadyExistsError,
} from "./transfer";

function setPayment(row: Record<string, unknown>) {
  supabaseTables.payments = { row };
}
function setDeal(row: Record<string, unknown>) {
  supabaseTables.deals = { row };
}
function setShowProfile(row: Record<string, unknown>) {
  supabaseTables.show_profiles = { row, maybeRow: row };
}
function setShow(row: Record<string, unknown>) {
  supabaseTables.shows = { row, maybeRow: row };
}
function setVerifiedDeal(row: { id: string; show_profile_id: string; show_id?: string }) {
  const showId = row.show_id ?? `show_${row.id}`;
  setDeal({ id: row.id, show_id: showId, show_profile_id: row.show_profile_id });
  supabaseTables.show_ownership_proofs = {
    rows: [{ id: "proof-1", show_id: showId, show_profile_id: row.show_profile_id, status: "verified" }],
  };
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
  stripe.transfers.list.mockReset();
  stripe.transfers.list.mockResolvedValue({ data: [] });
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, id: "em_1" });
  getAuthEmail.mockReset();
  getAuthEmail.mockResolvedValue("owner@example.com");
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

  it.each([
    { label: "10%", charged: 27500, fee: 2500 },
    { label: "8%", charged: 27000, fee: 2000 },
    { label: "6%", charged: 26500, fee: 1500 },
  ])(
    "transfers the full $250 gross on a settled $250 line at $label (brand paid the fee on top)",
    async ({ charged, fee }) => {
      setPayment({
        id: "pay_2",
        deal_id: "deal_2",
        io_line_item_id: "li_2",
        stripe_payment_intent_id: "pi_pay_2",
        amount_charged_cents: charged,
        application_fee_amount_cents: fee,
        gross_amount_cents: 25000,
        settled_at: SETTLED_AT,
      });
      setExistingPayout(null);
      setVerifiedDeal({ id: "deal_2", show_profile_id: "sp_2" });
      setShowProfile({ id: "sp_2", user_id: "user_2" });
      setProfile({ id: "user_2", stripe_connect_account_id: "acct_show_2" });

      const result = await transferPayoutForPayment("pay_2");

      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_pay_2");
      expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
      const [args, opts] = stripe.transfers.create.mock.calls[0];
      expect(args).toMatchObject({
        amount: 25000,
        currency: "usd",
        destination: "acct_show_2",
        // Funded by the brand's charge, never the platform balance.
        source_transaction: "ch_test_1",
        transfer_group: "deal_2",
      });
      expect(opts).toMatchObject({ idempotencyKey: "transfer:v2:pay_2" });
      expect(stripe.transfers.list).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        payoutId: "po_persisted_1",
        stripeTransferId: "tr_test_123",
        amountCents: 25000,
      });
      expect(payoutInsertCapture.value).toMatchObject({
        payment_id: "pay_2",
        stripe_transfer_id: "tr_test_123",
        amount_cents: 25000,
        early_payout_fee_cents: 0,
      });
    }
  );

  it("refuses to transfer when the IO gross was not snapshotted", async () => {
    setPayment({
      id: "pay_missing_gross",
      deal_id: "deal_2",
      io_line_item_id: "li_2",
      stripe_payment_intent_id: "pi_pay_2",
      amount_charged_cents: 27500,
      application_fee_amount_cents: 2500,
      gross_amount_cents: null,
      settled_at: SETTLED_AT,
    });

    await expect(transferPayoutForPayment("pay_missing_gross")).rejects.toThrow(
      /gross_amount_cents/
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("is idempotent — returns existing payout and skips Stripe when one already exists", async () => {
    setPayment({
      id: "pay_3",
      deal_id: "deal_3",
      io_line_item_id: "li_3",
      stripe_payment_intent_id: "pi_pay_3",
      amount_charged_cents: 26500,
      application_fee_amount_cents: 1500,
      gross_amount_cents: 25000,
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
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setVerifiedDeal({ id: "deal_4", show_profile_id: "sp_4" });
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
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
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
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setVerifiedDeal({ id: "deal_6", show_profile_id: "sp_6" });
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
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setVerifiedDeal({ id: "deal_7", show_profile_id: "sp_7" });
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

  it("holds an unverified owner's payout without calling Stripe", async () => {
    setPayment({
      id: "pay_hold",
      deal_id: "deal_hold",
      io_line_item_id: "li_hold",
      stripe_payment_intent_id: "pi_hold",
      amount_charged_cents: 27500,
      application_fee_amount_cents: 2500,
      gross_amount_cents: 25000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout(null);
    supabaseTables.payouts = { ...(supabaseTables.payouts ?? {}), row: { id: "po_held" } };
    setDeal({ id: "deal_hold", show_id: "show_hold", show_profile_id: "sp_hold" });
    setShow({ id: "show_hold", name: "Odd <Lots> & Co" });
    setShowProfile({ id: "sp_hold", user_id: "user_hold" });

    const result = await transferPayoutForPayment("pay_hold");

    expect(result).toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.transfers.list).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("profiles");
    expect(payoutInsertCapture.value).toMatchObject({
      payment_id: "pay_hold",
      stripe_transfer_id: null,
      amount_cents: 25000,
      early_payout_fee_cents: 0,
      transferred_at: null,
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payout.held",
        payload: {
          payment_id: "pay_hold",
          deal_id: "deal_hold",
          amount_cents: 25000,
        },
      })
    );
    const heldPayload = JSON.stringify(vi.mocked(logEvent).mock.calls);
    expect(heldPayload).not.toContain("owner@example.com");
    expect(heldPayload).not.toContain("acct_");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as { html: string; subject: string; to: string; recipientProfileId: string };
    expect(mail.subject).toBe("Verify your show to get paid");
    expect(mail.to).toBe("owner@example.com");
    expect(mail.recipientProfileId).toBe("user_hold");
    expect(mail.html).toContain("Odd &lt;Lots&gt; &amp; Co");
    expect(mail.html).not.toContain("Odd <Lots>");
    expect(mail.html).not.toContain("25000");

    sendEmail.mockClear();
    vi.mocked(logEvent).mockClear();
    setExistingPayout({
      id: "po_held",
      stripe_transfer_id: null,
      amount_cents: 25000,
      transferred_at: null,
    });
    const again = await transferPayoutForPayment("pay_hold");
    expect(again).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("keeps the hold when the owner email fails", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    sendEmail.mockResolvedValue({ ok: false, reason: "send_failed", error: "secret-db-text" });
    setPayment({
      id: "pay_mail",
      deal_id: "deal_mail",
      io_line_item_id: "li_mail",
      stripe_payment_intent_id: "pi_mail",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout(null);
    supabaseTables.payouts = { ...(supabaseTables.payouts ?? {}), row: { id: "po_mail" } };
    setDeal({ id: "deal_mail", show_id: "show_mail", show_profile_id: "sp_mail" });
    setShow({ id: "show_mail", name: "Quiet Show" });
    setShowProfile({ id: "sp_mail", user_id: "user_mail" });

    await expect(transferPayoutForPayment("pay_mail")).resolves.toBeNull();
    expect(payoutInsertCapture.value).toMatchObject({ stripe_transfer_id: null });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("send_failed");
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logs.join("\n")).not.toContain("owner@example.com");
  });

  it("holds when the proof read fails, throws, or show_id is null", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    setPayment({
      id: "pay_gate",
      deal_id: "deal_gate",
      io_line_item_id: "li_gate",
      stripe_payment_intent_id: "pi_gate",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout(null);
    supabaseTables.payouts = { ...(supabaseTables.payouts ?? {}), row: { id: "po_gate" } };
    setDeal({ id: "deal_gate", show_id: "show_gate", show_profile_id: "sp_gate" });
    setShowProfile({ id: "sp_gate", user_id: "user_gate" });
    supabaseTables.show_ownership_proofs = {
      readError: { code: "42501", message: "secret-db-text" },
      rows: [{ id: "proof", show_id: "show_gate", show_profile_id: "sp_gate", status: "verified" }],
    };

    await expect(transferPayoutForPayment("pay_gate")).resolves.toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("42501");
    expect(logs.join("\n")).not.toContain("secret-db-text");

    supabaseTables.show_ownership_proofs = { readThrow: new Error("secret-db-text") };
    setExistingPayout({
      id: "po_gate",
      stripe_transfer_id: null,
      amount_cents: 10000,
      transferred_at: null,
    });
    await expect(transferPayoutForPayment("pay_gate")).resolves.toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();

    setDeal({ id: "deal_gate", show_id: null, show_profile_id: "sp_gate" });
    setExistingPayout(null);
    supabaseTables.payouts = { row: { id: "po_gate_2" }, maybeRow: null };
    await expect(transferPayoutForPayment("pay_gate")).resolves.toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it.each(["failed", "disputed"])("leaves a %s payment held", async (status) => {
    setPayment({
      id: "pay_bad",
      deal_id: "deal_bad",
      io_line_item_id: "li_bad",
      stripe_payment_intent_id: "pi_bad",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
      status,
    });
    setExistingPayout({
      id: "po_bad",
      stripe_transfer_id: null,
      amount_cents: 10000,
      transferred_at: null,
    });
    setVerifiedDeal({ id: "deal_bad", show_profile_id: "sp_bad" });

    await expect(transferPayoutForPayment("pay_bad")).resolves.toBeNull();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.transfers.list).not.toHaveBeenCalled();
    expect(payoutUpdateCapture.value).toBeNull();
  });

  it("adopts a matching transfer and does not create another", async () => {
    setPayment({
      id: "pay_adopt",
      deal_id: "deal_adopt",
      io_line_item_id: "li_adopt",
      stripe_payment_intent_id: "pi_adopt",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout({
      id: "po_adopt",
      stripe_transfer_id: null,
      amount_cents: 10000,
      transferred_at: null,
    });
    supabaseTables.payouts = {
      ...(supabaseTables.payouts ?? {}),
      updateResult: { id: "po_adopt" },
    };
    setVerifiedDeal({ id: "deal_adopt", show_profile_id: "sp_adopt" });
    setShowProfile({ id: "sp_adopt", user_id: "user_adopt" });
    setProfile({ id: "user_adopt", stripe_connect_account_id: "acct_adopt" });
    stripe.transfers.list.mockResolvedValue({
      data: [
        { id: "tr_early", metadata: { payment_id: "pay_adopt", early_payout: "true" }, reversed: false },
        { id: "tr_rev", metadata: { payment_id: "pay_adopt" }, reversed: true },
        { id: "tr_other", metadata: { payment_id: "pay_x" }, reversed: false },
        { id: "tr_adopt", metadata: { payment_id: "pay_adopt" }, reversed: false },
      ],
    });

    const result = await transferPayoutForPayment("pay_adopt");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.transfers.list).toHaveBeenCalledWith({ transfer_group: "deal_adopt", limit: 100 });
    expect(payoutUpdateCapture.value).toMatchObject({ stripe_transfer_id: "tr_adopt", amount_cents: 10000 });
    expect(result).toEqual({ payoutId: "po_adopt", stripeTransferId: "tr_adopt", amountCents: 10000 });
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "payout.transferred" }));
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payout.released",
        payload: { payment_id: "pay_adopt", stripe_transfer_id: "tr_adopt" },
      })
    );
  });

  it("throws payout_conflict instead of overwriting a different transfer id", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    setPayment({
      id: "pay_conflict",
      deal_id: "deal_conflict",
      io_line_item_id: "li_conflict",
      stripe_payment_intent_id: "pi_conflict",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout({
      id: "po_conflict",
      stripe_transfer_id: null,
      amount_cents: 10000,
      transferred_at: null,
    });
    supabaseTables.payouts = {
      ...(supabaseTables.payouts ?? {}),
      updateResult: null,
      reread: {
        id: "po_conflict",
        stripe_transfer_id: "tr_other",
        amount_cents: 10000,
        transferred_at: SETTLED_AT,
      },
    };
    setVerifiedDeal({ id: "deal_conflict", show_profile_id: "sp_conflict" });
    setShowProfile({ id: "sp_conflict", user_id: "user_conflict" });
    setProfile({ id: "user_conflict", stripe_connect_account_id: "acct_conflict" });

    await expect(transferPayoutForPayment("pay_conflict")).rejects.toThrow("payout_conflict");
    expect(logs.join("\n")).toContain("payout_conflict");
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: "payout.released" }));
  });

  it("does not email again when the held insert races", async () => {
    setPayment({
      id: "pay_race",
      deal_id: "deal_race",
      io_line_item_id: "li_race",
      stripe_payment_intent_id: "pi_race",
      amount_charged_cents: 11000,
      application_fee_amount_cents: 1000,
      gross_amount_cents: 10000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout(null);
    supabaseTables.payouts = {
      ...(supabaseTables.payouts ?? {}),
      insertError: { code: "23505", message: "secret-db-text" },
      reread: { id: "po_other", stripe_transfer_id: null, amount_cents: 10000, transferred_at: null },
    };
    setDeal({ id: "deal_race", show_id: "show_race", show_profile_id: "sp_race" });

    await expect(transferPayoutForPayment("pay_race")).resolves.toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("transferEarlyPayoutForPayment — fee math + double-payout protection", () => {
  it("applies the 2.5% early-payout fee to the full IO gross", async () => {
    setPayment({
      id: "pay_e1",
      deal_id: "deal_e1",
      io_line_item_id: "li_e1",
      stripe_payment_intent_id: "pi_pay_e1",
      amount_charged_cents: 27500, // $275 charged (gross + 10%)
      application_fee_amount_cents: 2500,
      gross_amount_cents: 25000,
      settled_at: SETTLED_AT,
    });
    setExistingPayout(null);
    setVerifiedDeal({ id: "deal_e1", show_profile_id: "sp_e1" });
    setShowProfile({ id: "sp_e1", user_id: "user_e1" });
    setProfile({ id: "user_e1", stripe_connect_account_id: "acct_e1" });

    const result = await transferEarlyPayoutForPayment("pay_e1", 0.025);

    // Show gross = 25000
    // Early fee = round(25000 * 0.025) = 625
    // Transfer = 25000 - 625 = 24375
    const [args, opts] = stripe.transfers.create.mock.calls[0];
    expect(args.amount).toBe(24375);
    expect(args.source_transaction).toBe("ch_test_1");
    expect(opts).toMatchObject({ idempotencyKey: "transfer-early:v2:pay_e1" });
    expect(result.amountCents).toBe(24375);
    expect(payoutInsertCapture.value).toMatchObject({
      payment_id: "pay_e1",
      amount_cents: 24375,
      early_payout_fee_cents: 625,
    });
  });

  it("refuses early payout when an automatic payout already fired", async () => {
    setPayment({
      id: "pay_e2",
      deal_id: "deal_e2",
      io_line_item_id: "li_e2",
      stripe_payment_intent_id: "pi_pay_e2",
      amount_charged_cents: 27500,
      application_fee_amount_cents: 2500,
      gross_amount_cents: 25000,
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
    ).rejects.toBeInstanceOf(PayoutAlreadyExistsError);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("refuses early payout when a held row is already waiting", async () => {
    setPayment({
      id: "pay_e4",
      deal_id: "deal_e4",
      io_line_item_id: "li_e4",
      stripe_payment_intent_id: "pi_pay_e4",
      amount_charged_cents: 27500,
      application_fee_amount_cents: 2500,
      gross_amount_cents: 25000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout({
      id: "po_held",
      stripe_transfer_id: null,
      amount_cents: 25000,
      transferred_at: null,
    });

    await expect(transferEarlyPayoutForPayment("pay_e4", 0.025)).rejects.toBeInstanceOf(
      PayoutAlreadyExistsError
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.transfers.list).not.toHaveBeenCalled();
  });

  it("throws PayoutHeldError for an unverified owner and calls no Stripe API", async () => {
    setPayment({
      id: "pay_e5",
      deal_id: "deal_e5",
      io_line_item_id: "li_e5",
      stripe_payment_intent_id: "pi_pay_e5",
      amount_charged_cents: 27500,
      application_fee_amount_cents: 2500,
      gross_amount_cents: 25000,
      settled_at: SETTLED_AT,
      status: "succeeded",
    });
    setExistingPayout(null);
    setDeal({ id: "deal_e5", show_id: "show_e5", show_profile_id: "sp_e5" });
    supabaseTables.show_ownership_proofs = { rows: [] };

    await expect(transferEarlyPayoutForPayment("pay_e5", 0.025)).rejects.toBeInstanceOf(PayoutHeldError);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(payoutInsertCapture.value).toBeNull();
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
