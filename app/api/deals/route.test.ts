import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthenticatedUser,
  createDeal,
  getUserProfile,
  ensureProfile,
  getShowById,
  getDealsFiltered,
  createClient,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  createDeal: vi.fn(),
  getUserProfile: vi.fn(),
  ensureProfile: vi.fn(),
  getShowById: vi.fn(),
  getDealsFiltered: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealsFiltered: (...a: unknown[]) => getDealsFiltered(...a),
  createDeal: (...a: unknown[]) => createDeal(...a),
  getUserProfile: (...a: unknown[]) => getUserProfile(...a),
  ensureProfile: (...a: unknown[]) => ensureProfile(...a),
  getShowById: (...a: unknown[]) => getShowById(...a),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...a: unknown[]) => createClient(...a),
}));

import { GET, POST } from "./route";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOW_ID = "11111111-1111-4111-8111-111111111111";

const showLookupCalls: Array<{ method: string; column: string; value: string }> = [];

function showsBuilder(rows: Array<{ id: string; name: string }>) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn((column: string, value: string) => {
    showLookupCalls.push({ method: "eq", column, value });
    return builder;
  });
  builder.ilike = vi.fn((column: string, value: string) => {
    showLookupCalls.push({ method: "ilike", column, value });
    return builder;
  });
  builder.limit = vi.fn(async () => ({ data: rows, error: null }));
  return builder;
}

function postReq(body: object): Request {
  return new Request("http://x/api/deals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    show_id: SHOW_ID,
    brand_id: "someone-else",
    agent_id: "also-someone-else",
    num_episodes: 2,
    placement: "mid-roll",
    ad_format: "host_read",
    price_type: "cpm",
    cpm_rate: 25,
    guaranteed_downloads: 10000,
    is_scripted: false,
    is_personal_experience: true,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    flight_start: "2026-11-01",
    flight_end: "2026-11-15",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  showLookupCalls.length = 0;
  createClient.mockResolvedValue({
    from: () => showsBuilder([{ id: SHOW_ID, name: "Hit" }]),
  });
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "brand@taylslate.com" });
  getUserProfile.mockResolvedValue({ id: USER_ID, role: "brand", email: "brand@taylslate.com" });
  getShowById.mockResolvedValue({ id: SHOW_ID, name: "Oddvice" });
  createDeal.mockImplementation(async (row: { id?: string }) => ({ id: "deal-new", ...row }));
});

describe("POST /api/deals", () => {
  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(postReq(validBody()) as never);
    expect(res.status).toBe(401);
    expect(createDeal).not.toHaveBeenCalled();
  });

  it("returns field errors on 400 and does not insert", async () => {
    const res = await POST(postReq(validBody({ show_id: "", flight_start: "" })) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields.show_id).toBeTruthy();
    expect(body.fields.flight_start).toBeTruthy();
    expect(createDeal).not.toHaveBeenCalled();
  });

  it("stamps the signed-in brand and ignores client party ids", async () => {
    const res = await POST(postReq(validBody()) as never);
    expect(res.status).toBe(201);
    const inserted = createDeal.mock.calls[0][0];
    expect(inserted.brand_id).toBe(USER_ID);
    expect(inserted.agent_id).toBeUndefined();
    expect(inserted.agency_id).toBeUndefined();
    expect(inserted.show_id).toBe(SHOW_ID);
    expect(inserted.status).toBe("planning");
    expect(inserted.net_per_episode).toBe(250);
    expect(inserted.total_net).toBe(500);
    const body = await res.json();
    expect(body.deal.id).toBe("deal-new");
  });

  it("stamps an agent on agent_id", async () => {
    getUserProfile.mockResolvedValue({ id: USER_ID, role: "agent", email: "agent@taylslate.com" });
    const res = await POST(postReq(validBody()) as never);
    expect(res.status).toBe(201);
    const inserted = createDeal.mock.calls[0][0];
    expect(inserted.agent_id).toBe(USER_ID);
    expect(inserted.brand_id).toBe(USER_ID);
  });

  it("stores a flat rate as the per-episode net", async () => {
    const res = await POST(
      postReq(validBody({ price_type: "flat_rate", flat_rate: 875, cpm_rate: 1, num_episodes: 1 })) as never
    );
    expect(res.status).toBe(201);
    const inserted = createDeal.mock.calls[0][0];
    expect(inserted.net_per_episode).toBe(875);
    expect(inserted.total_net).toBe(875);
    expect(inserted.price_type).toBe("flat_rate");
  });

  it("returns a field error when the show does not exist", async () => {
    getShowById.mockResolvedValue(null);
    const res = await POST(postReq(validBody()) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields.show_id).toMatch(/No show/);
    expect(createDeal).not.toHaveBeenCalled();
  });

  it("looks up a percent in the show name as a literal", async () => {
    const res = await POST(postReq(validBody({ show_id: undefined, show_name: "%" })) as never);
    expect(res.status).toBe(201);
    expect(showLookupCalls).toEqual([{ method: "ilike", column: "name", value: "\\%" }]);
    expect(createDeal.mock.calls[0][0].show_id).toBe(SHOW_ID);
  });

  it("looks up a star in the show name with an exact match", async () => {
    const res = await POST(postReq(validBody({ show_id: undefined, show_name: "Show*" })) as never);
    expect(res.status).toBe(201);
    expect(showLookupCalls).toEqual([{ method: "eq", column: "name", value: "Show*" }]);
    expect(showLookupCalls.some((call) => call.method === "ilike")).toBe(false);
    expect(createDeal.mock.calls[0][0].show_id).toBe(SHOW_ID);
  });
});

describe("GET /api/deals", () => {
  it("returns a fixed error and hides the database message", async () => {
    getDealsFiltered.mockRejectedValueOnce(new Error("secret-db-text relation deals"));
    const res = await GET(new Request("http://x/api/deals") as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to fetch deals" });
    expect(JSON.stringify(body)).not.toContain("secret-db-text");
    expect(JSON.stringify(body)).not.toContain("relation");
  });
});
