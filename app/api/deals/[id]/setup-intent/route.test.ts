import { describe, it, expect, vi, beforeEach } from "vitest";

interface Builder {
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  _updates: unknown[];
  _setSingle: (data: unknown, error?: unknown) => void;
}

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getWave12DealById,
  createSetupIntentForBrand,
  logEvent,
  stripe,
  supabaseAdmin,
} = vi.hoisted(() => {
  const builders: Record<string, Builder> = {};
  function makeBuilder(): Builder {
    let single: { data: unknown; error: unknown } = { data: null, error: null };
    const b: Builder = {
      _updates: [],
      _setSingle: (data: unknown, error: unknown = null) => {
        single = { data, error };
      },
      update: vi.fn((payload: unknown) => {
        b._updates.push(payload);
        return b;
      }),
      select: vi.fn(() => b),
      eq: vi.fn(() => {
        const r: Record<string, unknown> = { ...b };
        r.single = b.single;
        r.then = (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF);
        return r;
      }),
      single: vi.fn(async () => single),
    };
    return b;
  }
  return {
    getAuthenticatedUser: vi.fn(),
    getBrandProfileByUserId: vi.fn(),
    getWave12DealById: vi.fn(),
    createSetupIntentForBrand: vi.fn(),
    logEvent: vi.fn().mockResolvedValue(null),
    stripe: { setupIntents: { retrieve: vi.fn() } },
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        if (!builders[table]) builders[table] = makeBuilder();
        return builders[table];
      }),
      _builders: builders,
    },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/stripe/server", () => ({ stripe }));
vi.mock("@/lib/stripe/setup-intent", () => ({
  createSetupIntentForBrand: (...a: unknown[]) => createSetupIntentForBrand(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { POST } from "./route";

const params = Promise.resolve({ id: "deal_1" });
function req(): Request {
  return new Request("http://x/api/deals/deal_1/setup-intent", { method: "POST" });
}

function signedDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal_1",
    brand_profile_id: "bp_1",
    brand_signed_at: "2026-08-12T12:00:00Z",
    setup_intent_id: null,
    setup_intent_client_secret: null,
    payment_method_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(supabaseAdmin._builders)) delete supabaseAdmin._builders[k];
});

describe("POST /api/deals/[id]/setup-intent", () => {
  it("rejects unauthenticated callers", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(401);
  });

  it("404 when the deal does not exist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(null);
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(404);
  });

  it("forbids a user who does not own the deal's brand profile", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_other", email: "o@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal());
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_other" });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(403);
    expect(createSetupIntentForBrand).not.toHaveBeenCalled();
  });

  it("409 — an unsigned IO cannot create a SetupIntent", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal({ brand_signed_at: null }));
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1" });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(409);
    expect(createSetupIntentForBrand).not.toHaveBeenCalled();
  });

  it("returns already_saved when the deal already has a payment method", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal({ payment_method_id: "pm_existing" }));
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1" });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_saved");
    expect(createSetupIntentForBrand).not.toHaveBeenCalled();
  });

  it("reuses an existing open SetupIntent instead of minting a new one", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(
      signedDeal({ setup_intent_id: "seti_1", setup_intent_client_secret: "old_secret" })
    );
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1" });
    stripe.setupIntents.retrieve.mockResolvedValueOnce({
      id: "seti_1",
      status: "requires_payment_method",
      client_secret: "seti_1_secret_new",
      metadata: { deal_id: "deal_1" },
    });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("reused");
    expect(body.client_secret).toBe("seti_1_secret_new");
    expect(createSetupIntentForBrand).not.toHaveBeenCalled();
    // Re-synced the drifted client secret onto the deal.
    expect(supabaseAdmin._builders.deals._updates).toContainEqual({
      setup_intent_client_secret: "seti_1_secret_new",
    });
  });

  it("backfills payment_method_id when the existing SetupIntent already succeeded", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u1", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal({ setup_intent_id: "seti_1" }));
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1" });
    stripe.setupIntents.retrieve.mockResolvedValueOnce({
      id: "seti_1",
      status: "succeeded",
      payment_method: "pm_confirmed",
      client_secret: "x",
      metadata: { deal_id: "deal_1" },
    });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_saved");
    expect(body.payment_method_id).toBe("pm_confirmed");
    expect(supabaseAdmin._builders.deals._updates).toContainEqual({
      payment_method_id: "pm_confirmed",
    });
    expect(createSetupIntentForBrand).not.toHaveBeenCalled();
  });

  it("creates a fresh SetupIntent with deal metadata and persists it", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_brand", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal());
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1", brand_identity: "Acme Co." });
    supabaseAdmin.from("profiles")._setSingle({
      id: "u_brand",
      email: "b@x.com",
      full_name: "Brand Owner",
      company_name: null,
      stripe_customer_id: null,
    });
    createSetupIntentForBrand.mockResolvedValueOnce({
      setupIntentId: "seti_new",
      clientSecret: "seti_new_secret",
      stripeCustomerId: "cus_1",
    });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("created");
    expect(body.client_secret).toBe("seti_new_secret");
    expect(createSetupIntentForBrand).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "deal_1" })
    );
    expect(supabaseAdmin._builders.deals._updates).toContainEqual({
      setup_intent_id: "seti_new",
      setup_intent_client_secret: "seti_new_secret",
    });
    const types = logEvent.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(types).toContain("deal.setup_intent_created");
  });

  it("never reuses/backfills a SetupIntent whose metadata.deal_id belongs to another deal", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_brand", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal({ setup_intent_id: "seti_other" }));
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1", brand_identity: "Acme Co." });
    // A drifted/stale id that Stripe confirms belongs to a DIFFERENT deal —
    // even though it already succeeded with a card, we must NOT bind it here.
    stripe.setupIntents.retrieve.mockResolvedValueOnce({
      id: "seti_other",
      status: "succeeded",
      payment_method: "pm_wrong_deal",
      client_secret: "seti_other_secret",
      metadata: { deal_id: "deal_999" },
    });
    supabaseAdmin.from("profiles")._setSingle({
      id: "u_brand",
      email: "b@x.com",
      full_name: null,
      company_name: null,
      stripe_customer_id: "cus_1",
    });
    createSetupIntentForBrand.mockResolvedValueOnce({
      setupIntentId: "seti_fresh",
      clientSecret: "seti_fresh_secret",
      stripeCustomerId: "cus_1",
    });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Fell through to a fresh, correctly-tagged SetupIntent — did NOT reuse.
    expect(body.status).toBe("created");
    expect(createSetupIntentForBrand).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "deal_1" })
    );
    // Crucially: the other deal's card was never bound to this deal.
    const dealUpdates = supabaseAdmin._builders.deals?._updates ?? [];
    expect(dealUpdates).not.toContainEqual({ payment_method_id: "pm_wrong_deal" });
  });

  it("falls through to create when retrieving a stale SetupIntent throws", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_brand", email: "b@x.com" });
    getWave12DealById.mockResolvedValueOnce(signedDeal({ setup_intent_id: "seti_stale" }));
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1", brand_identity: "Acme Co." });
    stripe.setupIntents.retrieve.mockRejectedValueOnce(new Error("No such setupintent"));
    supabaseAdmin.from("profiles")._setSingle({
      id: "u_brand",
      email: "b@x.com",
      full_name: null,
      company_name: null,
      stripe_customer_id: "cus_1",
    });
    createSetupIntentForBrand.mockResolvedValueOnce({
      setupIntentId: "seti_fresh",
      clientSecret: "seti_fresh_secret",
      stripeCustomerId: "cus_1",
    });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("created");
    expect(createSetupIntentForBrand).toHaveBeenCalled();
  });
});
