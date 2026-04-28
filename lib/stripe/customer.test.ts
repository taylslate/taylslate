import { describe, it, expect, vi, beforeEach } from "vitest";

const { stripe, supabaseAdmin, profilesBuilder } = vi.hoisted(() => {
  const builder = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    stripe: {
      customers: {
        create: vi.fn(),
      },
    },
    supabaseAdmin: {
      from: vi.fn(() => builder),
    },
    profilesBuilder: builder,
  };
});

vi.mock("./server", () => ({ stripe }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { getOrCreateStripeCustomer } from "./customer";

describe("getOrCreateStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profilesBuilder.eq.mockResolvedValue({ data: null, error: null });
  });

  it("returns existing stripe_customer_id without calling Stripe", async () => {
    const id = await getOrCreateStripeCustomer({
      id: "p_123",
      email: "brand@example.com",
      stripe_customer_id: "cus_existing",
    });
    expect(id).toBe("cus_existing");
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("creates a Stripe customer and persists the id when missing", async () => {
    stripe.customers.create.mockResolvedValueOnce({ id: "cus_new" });

    const id = await getOrCreateStripeCustomer({
      id: "p_456",
      email: "brand2@example.com",
      full_name: "Brand Two",
      company_name: "Brand Two Inc",
    });

    expect(id).toBe("cus_new");
    expect(stripe.customers.create).toHaveBeenCalledWith({
      email: "brand2@example.com",
      name: "Brand Two",
      metadata: { profile_id: "p_456", company_name: "Brand Two Inc" },
    });
    expect(supabaseAdmin.from).toHaveBeenCalledWith("profiles");
    expect(profilesBuilder.update).toHaveBeenCalledWith({
      stripe_customer_id: "cus_new",
    });
    expect(profilesBuilder.eq).toHaveBeenCalledWith("id", "p_456");
  });

  it("throws if persisting the new id fails", async () => {
    stripe.customers.create.mockResolvedValueOnce({ id: "cus_new" });
    profilesBuilder.eq.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied" },
    });

    await expect(
      getOrCreateStripeCustomer({
        id: "p_789",
        email: "brand3@example.com",
      })
    ).rejects.toThrow(/permission denied/);
  });
});
