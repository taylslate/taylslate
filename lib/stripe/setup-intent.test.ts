import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe SDK surface and the customer helper so this unit test never
// touches the network or Supabase. We spy on the money-mutating endpoints
// (subscriptions/invoices) to prove card capture creates NONE of them.
const { stripe, getOrCreateStripeCustomer } = vi.hoisted(() => ({
  stripe: {
    setupIntents: { create: vi.fn() },
    subscriptions: { create: vi.fn() },
    invoices: { create: vi.fn() },
    invoiceItems: { create: vi.fn() },
  },
  getOrCreateStripeCustomer: vi.fn(),
}));

vi.mock("./server", () => ({ stripe }));
vi.mock("./customer", () => ({
  getOrCreateStripeCustomer: (...a: unknown[]) => getOrCreateStripeCustomer(...a),
}));

import { createSetupIntentForBrand } from "./setup-intent";

const profile = { id: "prof_1", email: "brand@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateStripeCustomer.mockResolvedValue("cus_1");
  stripe.setupIntents.create.mockResolvedValue({
    id: "seti_1",
    client_secret: "seti_1_secret",
  });
});

describe("createSetupIntentForBrand", () => {
  it("creates a setup-mode SetupIntent (off_session, card) with deal metadata", async () => {
    const result = await createSetupIntentForBrand({ profile, dealId: "deal_1" });

    expect(stripe.setupIntents.create).toHaveBeenCalledTimes(1);
    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { profile_id: "prof_1", deal_id: "deal_1" },
      })
    );
    expect(result).toEqual({
      setupIntentId: "seti_1",
      clientSecret: "seti_1_secret",
      stripeCustomerId: "cus_1",
    });
  });

  it("defaults payment_method_types to ['card'] and honors an override", async () => {
    await createSetupIntentForBrand({ profile, dealId: "deal_1" });
    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method_types: ["card"] })
    );

    stripe.setupIntents.create.mockClear();
    await createSetupIntentForBrand({
      profile,
      dealId: "deal_1",
      paymentMethodTypes: ["card", "us_bank_account"],
    });
    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method_types: ["card", "us_bank_account"] })
    );
  });

  it("does NOT create any subscription or invoice on capture (alpha fee = 0, setup mode only)", async () => {
    await createSetupIntentForBrand({ profile, dealId: "deal_1" });

    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(stripe.invoices.create).not.toHaveBeenCalled();
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
  });

  it("throws if Stripe returns a SetupIntent without a client_secret", async () => {
    stripe.setupIntents.create.mockResolvedValueOnce({ id: "seti_bad", client_secret: null });
    await expect(
      createSetupIntentForBrand({ profile, dealId: "deal_1" })
    ).rejects.toThrow(/without a client_secret/);
  });
});
