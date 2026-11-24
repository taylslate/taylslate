import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedUser,
  getDealById,
  getShowById,
  getProfileById,
  getNextIONumber,
  createIO,
  getIOByDealId,
  isShowsAdmin,
  supabaseAdmin,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDealById: vi.fn(),
  getShowById: vi.fn(),
  getProfileById: vi.fn(),
  getNextIONumber: vi.fn(),
  createIO: vi.fn(),
  getIOByDealId: vi.fn(),
  isShowsAdmin: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getShowById: (...a: unknown[]) => getShowById(...a),
  getProfileById: (...a: unknown[]) => getProfileById(...a),
  getNextIONumber: (...a: unknown[]) => getNextIONumber(...a),
  createIO: (...a: unknown[]) => createIO(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...a: unknown[]) => isShowsAdmin(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "deal-1" }) };

function deal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal-1",
    show_id: "show-1",
    brand_id: "brand-1",
    agent_id: "agent-1",
    agency_id: null,
    status: "planning",
    outreach_id: "outreach-1",
    brand_signed_at: null,
    show_signed_at: null,
    flight_start: "2026-05-01",
    num_episodes: 1,
    guaranteed_downloads: 1000,
    placement: "mid-roll",
    is_scripted: false,
    is_personal_experience: true,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    gross_per_episode: 25,
    net_per_episode: 25,
    gross_cpm: 25,
    cpm_rate: 25,
    price_type: "cpm",
    competitor_exclusion: [],
    exclusivity_days: 90,
    rofr_days: 30,
    ...overrides,
  };
}

function showRow(email: string | null, error: { code?: string } | null = null) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.maybeSingle = vi.fn(async () => ({
    data: error ? null : { contact_email: email },
    error,
  }));
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  isShowsAdmin.mockResolvedValue(false);
  getNextIONumber.mockResolvedValue("IO-2026-0008");
  getShowById.mockResolvedValue({
    id: "show-1",
    name: "Harbor",
    platform: "podcast",
    episode_cadence: "weekly",
    contact: { name: "Host", email: "" },
  });
  getProfileById.mockImplementation(async (id: string) => {
    if (id === "brand-1") return { company_name: "Northwind", full_name: "Brand", email: "brand@example.test" };
    if (id === "agent-1") return { company_name: "Harbor", full_name: "Host", email: "host@example.test" };
    return null;
  });
  getIOByDealId.mockResolvedValue(null);
  supabaseAdmin.from.mockImplementation(() => showRow("host@example.test"));
  createIO.mockImplementation(async (row: Record<string, unknown>) => ({
    ...row,
    id: "io-1",
    publisher_contact_email: undefined,
    line_items: [],
  }));
});

function post(userId: string) {
  getAuthenticatedUser.mockResolvedValue({ id: userId });
  return POST(new Request("http://x/api/deals/deal-1/io/generate", { method: "POST" }) as never, params as never);
}

describe("POST /api/deals/[id]/io/generate", () => {
  it("returns 403 for a stranger before reading any IO", async () => {
    getDealById.mockResolvedValue(deal());
    const res = await post("stranger");
    expect(res.status).toBe(403);
    expect(getIOByDealId).not.toHaveBeenCalled();
    expect(createIO).not.toHaveBeenCalled();
  });

  it("masks an existing IO in the 409 body", async () => {
    getDealById.mockResolvedValue(deal());
    getIOByDealId.mockResolvedValue({
      id: "io-1",
      publisher_contact_email: "host@example.test",
      advertiser_contact_email: "brand@example.test",
      agency_contact_email: "desk@example.test",
      line_items: [],
    });
    const res = await post("brand-1");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.publisher_contact_hidden).toBe(true);
    expect(body.advertiser_contact_hidden).toBe(false);
    expect(body.io.publisher_contact_email).toBe("");
    expect(body.io.advertiser_contact_email).toBe("brand@example.test");
    expect(JSON.stringify(body)).not.toContain("host@example.test");
    expect(createIO).not.toHaveBeenCalled();
  });

  it("stores the admin show email and returns both flags for each side", async () => {
    getDealById.mockResolvedValue(deal());
    const brand = await post("brand-1");
    expect(brand.status).toBe(201);
    const brandBody = await brand.json();
    expect(createIO.mock.calls[0][0].publisher_contact_email).toBe("host@example.test");
    expect(brandBody.publisher_contact_hidden).toBe(true);
    expect(brandBody.advertiser_contact_hidden).toBe(false);
    expect(brandBody.io.publisher_contact_email).toBe("");
    expect(JSON.stringify(brandBody)).not.toContain("host@example.test");

    createIO.mockClear();
    const agent = await post("agent-1");
    const agentBody = await agent.json();
    expect(agentBody.publisher_contact_hidden).toBe(false);
    expect(agentBody.advertiser_contact_hidden).toBe(true);
    expect(agentBody.io.publisher_contact_email).toBe("host@example.test");
    expect(agentBody.io.advertiser_contact_email).toBe("");
    expect(JSON.stringify(agentBody)).not.toContain("brand@example.test");
  });

  it("stores an empty publisher email when the admin read fails and does not echo the error", async () => {
    getDealById.mockResolvedValue(deal());
    supabaseAdmin.from.mockImplementation(() => showRow(null, { code: "42501" }));
    const res = await post("agent-1");
    expect(res.status).toBe(201);
    expect(createIO.mock.calls[0][0].publisher_contact_email).toBe("");
    expect(JSON.stringify(await res.json())).not.toContain("42501");
  });

  it("returns a generic 500", async () => {
    getDealById.mockRejectedValue(new Error('relation "deals" does not exist'));
    const res = await post("brand-1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to generate IO" });
  });
});
