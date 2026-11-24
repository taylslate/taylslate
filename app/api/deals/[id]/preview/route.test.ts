import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getShowProfileByUserId,
  getOutreachById,
  getWave12DealById,
  getIOByDealId,
  isShowsAdmin,
  supabaseAdmin,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getBrandProfileByUserId: vi.fn(),
  getShowProfileByUserId: vi.fn(),
  getOutreachById: vi.fn(),
  getWave12DealById: vi.fn(),
  getIOByDealId: vi.fn(),
  isShowsAdmin: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getShowProfileByUserId: (...a: unknown[]) => getShowProfileByUserId(...a),
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...a: unknown[]) => isShowsAdmin(...a),
}));

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "deal-1" }) };

function deal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal-1",
    outreach_id: "outreach-1",
    brand_profile_id: "bp-1",
    show_profile_id: "sp-1",
    brand_id: "brand-1",
    agent_id: null,
    agency_id: null,
    status: "planning",
    brand_signed_at: null,
    show_signed_at: null,
    agreed_cpm: 25,
    agreed_episode_count: 1,
    agreed_placement: "mid-roll",
    agreed_flight_start: "2026-05-01",
    agreed_flight_end: "2026-05-31",
    created_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

function fromTable(table: string) {
  let id = "";
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn((_column: string, value: string) => {
    id = value;
    return builder;
  });
  builder.single = vi.fn(async () => {
    if (table === "profiles") {
      const email =
        id === "brand-1" ? "brand@example.test" : id === "show-1" ? "host@example.test" : "";
      return { data: { email }, error: null };
    }
    if (table === "brand_profiles") {
      return {
        data: {
          id: "bp-1",
          user_id: "brand-1",
          brand_name: "Northwind",
          brand_website: "https://northwind.example",
        },
        error: null,
      };
    }
    return {
      data: {
        id: "sp-1",
        user_id: "show-1",
        show_name: "Harbor",
        audience_size: 10000,
        episode_cadence: "weekly",
        ad_formats: ["host_read_baked"],
        ad_read_types: ["personal_experience"],
        ad_copy_email: "host@example.test",
        billing_email: "host@example.test",
        platform: "podcast",
      },
      error: null,
    };
  });
  return builder;
}

async function pdfText(userId: string) {
  getAuthenticatedUser.mockResolvedValue({ id: userId, email: `${userId}@example.test` });
  if (userId === "brand-1") {
    getBrandProfileByUserId.mockResolvedValue({ id: "bp-1" });
    getShowProfileByUserId.mockResolvedValue(null);
  } else {
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue({ id: "sp-1" });
  }
  const res = await GET({} as never, params as never);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

beforeEach(() => {
  vi.clearAllMocks();
  isShowsAdmin.mockResolvedValue(false);
  getIOByDealId.mockResolvedValue(null);
  getOutreachById.mockResolvedValue({ id: "outreach-1", show_name: "Harbor" });
  getWave12DealById.mockResolvedValue(deal());
  supabaseAdmin.from.mockImplementation((table: string) => fromTable(table));
});

describe("GET /api/deals/[id]/preview contact masking", () => {
  it("masks the show for the brand and the brand for the show while locked", async () => {
    const brand = await pdfText("brand-1");
    expect(brand).toContain("brand@example.test");
    expect(brand).not.toContain("host@example.test");
    expect(brand).toContain("Sent through Taylslate");

    const show = await pdfText("show-1");
    expect(show).toContain("host@example.test");
    expect(show).not.toContain("brand@example.test");
    expect(show).toContain("Sent through Taylslate");
  });

  it("shows both addresses after both sides sign", async () => {
    getWave12DealById.mockResolvedValue(
      deal({
        status: "show_signed",
        brand_signed_at: "2026-11-01",
        show_signed_at: "2026-11-02",
      })
    );
    const brand = await pdfText("brand-1");
    expect(brand).toContain("brand@example.test");
    expect(brand).toContain("host@example.test");
    const show = await pdfText("show-1");
    expect(show).toContain("brand@example.test");
    expect(show).toContain("host@example.test");
  });

  it("masks the other side again when a signed deal is cancelled", async () => {
    getWave12DealById.mockResolvedValue(
      deal({
        status: "cancelled",
        brand_signed_at: "2026-11-01",
        show_signed_at: "2026-11-02",
      })
    );
    const brand = await pdfText("brand-1");
    expect(brand).toContain("brand@example.test");
    expect(brand).not.toContain("host@example.test");
    const show = await pdfText("show-1");
    expect(show).toContain("host@example.test");
    expect(show).not.toContain("brand@example.test");
  });

  it("returns 403 for a caller who is not on the deal", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "stranger" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp-other" });
    getShowProfileByUserId.mockResolvedValue({ id: "sp-other" });
    const res = await GET({} as never, params as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });
});
