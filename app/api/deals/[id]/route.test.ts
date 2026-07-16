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
  getOutreachById.mockResolvedValue({ show_name: "Show" });
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
