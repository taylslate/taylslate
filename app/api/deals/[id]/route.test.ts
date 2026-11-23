import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for the deal-detail authorization gate (Codex P6). These
// handlers read/mutate via the admin client, so ownership MUST be enforced in
// the route — without callerOwnsDeal, any authenticated user could read or
// mutate any deal by UUID.

const {
  getAuthenticatedUser,
  getDealWithRelations,
  getDealById,
  updateDeal,
  deleteDeal,
  getWave12DealById,
  getOutreachById,
  getBrandProfileByUserId,
  getShowProfileByUserId,
  supabaseAdmin,
} = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    getAuthenticatedUser: vi.fn(),
    getDealWithRelations: vi.fn(),
    getDealById: vi.fn(),
    updateDeal: vi.fn(),
    deleteDeal: vi.fn(),
    getWave12DealById: vi.fn(),
    getOutreachById: vi.fn(),
    getBrandProfileByUserId: vi.fn(),
    getShowProfileByUserId: vi.fn(),
    adminBuilder: builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealWithRelations: (...a: unknown[]) => getDealWithRelations(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  updateDeal: (...a: unknown[]) => updateDeal(...a),
  deleteDeal: (...a: unknown[]) => deleteDeal(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getShowProfileByUserId: (...a: unknown[]) => getShowProfileByUserId(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { GET, PATCH, DELETE } from "./route";

const params = { params: Promise.resolve({ id: "deal-1" }) };

// A Wave-12 deal owned by brand_profile bp-owner / show_profile sp-owner.
const wave12Row = {
  id: "deal-1",
  outreach_id: "o1",
  brand_id: "legacy-brand",
  agent_id: null,
  agency_id: null,
  brand_profile_id: "bp-owner",
  show_profile_id: "sp-owner",
  status: "planning",
};

function patchReq(body: object): Request {
  return new Request("http://x/api/deals/deal-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "u-intruder", email: "intruder@x.com" });
  getDealById.mockResolvedValue(wave12Row);
  getDealWithRelations.mockResolvedValue(null);
  getWave12DealById.mockResolvedValue(wave12Row);
  getOutreachById.mockResolvedValue({
    show_name: "Show",
    token: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  });
  // The intruder owns neither the brand nor the show profile on the deal.
  getBrandProfileByUserId.mockResolvedValue({ id: "bp-intruder" });
  getShowProfileByUserId.mockResolvedValue({ id: "sp-intruder" });
});

describe("deals/[id] authorization gate", () => {
  it("GET returns 404 for a non-owner (no data leak)", async () => {
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(404);
    // Must not have reached the data-shaping path.
    expect(getWave12DealById).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 for a non-owner and never mutates", async () => {
    const res = await PATCH(patchReq({ status: "io_sent" }) as never, params as never);
    expect(res.status).toBe(404);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("DELETE returns 404 for a non-owner and never deletes", async () => {
    const res = await DELETE({} as never, params as never);
    expect(res.status).toBe(404);
    expect(deleteDeal).not.toHaveBeenCalled();
  });

  it("GET allows the owning brand through the gate", async () => {
    getBrandProfileByUserId.mockResolvedValue({ id: "bp-owner" });
    getShowProfileByUserId.mockResolvedValue(null);
    const res = await GET({} as never, params as never);
    // Owner passes the gate → proceeds to the Wave-12 shaping path.
    expect(getWave12DealById).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deal.outreach.token).toBe("");
    expect(body.deal.outreach.show_name).toBe("Show");
  });

  it("GET redacts the outreach token for the owning show", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u-show", email: "show@x.com" });
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue({ id: "sp-owner" });
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deal.outreach.token).toBe("");
    expect(body.deal.outreach.show_name).toBe("Show");
  });

  it("GET allows the owning show (legacy-column owner too)", async () => {
    // Legacy ownership path: caller is the legacy brand_id on the row.
    getAuthenticatedUser.mockResolvedValue({ id: "legacy-brand", email: "b@x.com" });
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue(null);
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(200);
  });
});

function asBuyer() {
  getAuthenticatedUser.mockResolvedValue({ id: "u-buyer", email: "buyer@example.com" });
  getBrandProfileByUserId.mockResolvedValue({ id: "bp-owner" });
  getShowProfileByUserId.mockResolvedValue(null);
  getDealById.mockResolvedValue({
    ...wave12Row,
    status: "planning",
    brand_signed_at: null,
    show_signed_at: null,
  });
  updateDeal.mockResolvedValue({ id: "deal-1", notes: "saved" });
}

describe("PATCH /api/deals/[id] field allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asBuyer();
  });

  it("writes an allowed note for the brand party", async () => {
    const res = await PATCH(patchReq({ notes: "Host keeps the read." }) as never, params as never);
    expect(res.status).toBe(200);
    expect(updateDeal).toHaveBeenCalledWith("deal-1", { notes: "Host keeps the read." });
    expect(getBrandProfileByUserId).toHaveBeenCalledWith("u-buyer");
  });

  it("keeps the legacy planning to io_sent transition", async () => {
    const res = await PATCH(patchReq({ status: "io_sent" }) as never, params as never);
    expect(res.status).toBe(200);
    expect(updateDeal).toHaveBeenCalledWith("deal-1", { status: "io_sent" });
  });

  it("refuses a money field and does not write", async () => {
    const res = await PATCH(
      patchReq({ notes: "ok", agreed_cpm: 10, total_gross: 99, payment_method_id: "pm_1" }) as never,
      params as never
    );
    expect(res.status).toBe(400);
    expect(updateDeal).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ error: "That update is not allowed." });
    expect(JSON.stringify(body)).not.toMatch(/agreed_cpm|total_gross|payment_method_id|pm_1|violat|duplicate|relation/i);
  });

  it("refuses a signature field", async () => {
    const res = await PATCH(
      patchReq({ brand_signed_at: "2026-05-01T00:00:00Z" }) as never,
      params as never
    );
    expect(res.status).toBe(400);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("refuses every edit after a signature timestamp", async () => {
    getDealById.mockResolvedValue({
      ...wave12Row,
      status: "show_signed",
      brand_signed_at: "2026-05-01T00:00:00Z",
      show_signed_at: null,
    });
    const res = await PATCH(patchReq({ notes: "too late" }) as never, params as never);
    expect(res.status).toBe(403);
    expect(updateDeal).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ error: "That update is not allowed." });
    expect(JSON.stringify(body)).not.toContain("2026-05-01");
  });

  it("refuses a transition to completed", async () => {
    getDealById.mockResolvedValue({
      ...wave12Row,
      status: "live",
      brand_signed_at: null,
      show_signed_at: null,
    });
    const res = await PATCH(patchReq({ status: "completed" }) as never, params as never);
    expect(res.status).toBe(403);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("refuses a show party editing placement", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u-show", email: "show@example.com" });
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue({ id: "sp-owner" });
    const res = await PATCH(patchReq({ placement: "pre-roll" }) as never, params as never);
    expect(res.status).toBe(400);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("lets the show party save a note", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u-show", email: "show@example.com" });
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue({ id: "sp-owner" });
    const res = await PATCH(patchReq({ notes: "We can air Friday." }) as never, params as never);
    expect(res.status).toBe(200);
    expect(updateDeal).toHaveBeenCalledWith("deal-1", { notes: "We can air Friday." });
    expect(getShowProfileByUserId).toHaveBeenCalledWith("u-show");
  });

  it("returns a generic body when the write fails", async () => {
    updateDeal.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "deals_pkey" detail=deal-1')
    );
    const res = await PATCH(patchReq({ notes: "x" }) as never, params as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to update deal" });
    expect(JSON.stringify(body)).not.toMatch(/duplicate|deals_pkey|deal-1|violat/i);
  });

  it("does not treat an email as a party", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u-intruder", email: "legacy-brand" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp-intruder" });
    getShowProfileByUserId.mockResolvedValue({ id: "sp-intruder" });
    const res = await PATCH(patchReq({ notes: "nope" }) as never, params as never);
    expect(res.status).toBe(404);
    expect(updateDeal).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ error: "Deal not found" });
    expect(JSON.stringify(body)).not.toContain("deal-1");
  });
});
