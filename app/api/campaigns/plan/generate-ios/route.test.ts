import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedUser,
  ensureProfile,
  getCampaignById,
  createShow,
  createDeal,
  createIO,
  getNextIONumber,
  getShowBySlug,
  updateDeal,
  fetchSurfaceAttachment,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  ensureProfile: vi.fn(),
  getCampaignById: vi.fn(),
  createShow: vi.fn(),
  createDeal: vi.fn(),
  createIO: vi.fn(),
  getNextIONumber: vi.fn(),
  getShowBySlug: vi.fn(),
  updateDeal: vi.fn(),
  fetchSurfaceAttachment: vi.fn(),
}));

vi.mock("@/lib/data/show-surfaces", () => ({
  fetchSurfaceAttachment: (...a: unknown[]) => fetchSurfaceAttachment(...a),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  ensureProfile: (...a: unknown[]) => ensureProfile(...a),
  getCampaignById: (...a: unknown[]) => getCampaignById(...a),
  createShow: (...a: unknown[]) => createShow(...a),
  createDeal: (...a: unknown[]) => createDeal(...a),
  createIO: (...a: unknown[]) => createIO(...a),
  getNextIONumber: (...a: unknown[]) => getNextIONumber(...a),
  getShowBySlug: (...a: unknown[]) => getShowBySlug(...a),
  updateDeal: (...a: unknown[]) => updateDeal(...a),
}));

import { POST } from "./route";

function campaign(brief: unknown) {
  return {
    id: "camp-1",
    user_id: "user-1",
    name: "Fall",
    brief,
    budget_total: 5000,
    platforms: ["podcast"],
    status: "planned",
    recommendations: [],
    scored_shows: [
      {
        podcastId: "pod-1",
        name: "Daily Briefing",
        description: "",
        imageUrl: null,
        categories: ["business"],
        publisherName: "Daily",
        audienceSize: 10000,
        estimatedCpm: 25,
        contactEmail: "host@show.test",
        rssUrl: null,
      },
    ],
    media_plan: {
      default_placement: "mid-roll",
      default_episodes: 3,
      spacing: "weekly",
      updated_at: "2026-06-01T00:00:00.000Z",
      line_items: [{ podcast_id: "pod-1", placement: "mid-roll", num_episodes: 3 }],
    },
  };
}

function post(body: unknown = { campaign_id: "camp-1" }) {
  return new Request("http://localhost/api/campaigns/plan/generate-ios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T18:00:00.000Z"));
  getAuthenticatedUser.mockResolvedValue({ id: "user-1", email: "brand@x.com" });
  ensureProfile.mockResolvedValue({ id: "user-1", company_name: "More/Less", full_name: "Brand", email: "brand@x.com" });
  getShowBySlug.mockResolvedValue({
    id: "show-1",
    name: "Daily Briefing",
    contact: { name: "Host", email: "host@show.test" },
  });
  createDeal.mockImplementation(async (row: { id?: string }) => ({ id: "deal-1", ...row }));
  getNextIONumber.mockResolvedValue("IO-2026-0009");
  createIO.mockResolvedValue({ id: "io-1" });
  fetchSurfaceAttachment.mockResolvedValue({ ok: true, surfaces: [], shows: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/campaigns/plan/generate-ios", () => {
  it("uses the campaign flight and leaves the deal in planning with a draft IO", async () => {
    getCampaignById.mockResolvedValue(
      campaign({
        version: 2,
        flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-10-15" },
      })
    );

    const res = await POST(post() as never);
    expect(res.status).toBe(200);

    const deal = createDeal.mock.calls[0][0];
    expect(deal.flight_start).toBe("2026-09-01");
    expect(deal.flight_end).toBe("2026-10-15");
    expect(deal.status).toBe("planning");

    const [io, lineItems] = createIO.mock.calls[0];
    expect(io.status).toBe("draft");
    expect(lineItems.map((li: { post_date: string }) => li.post_date)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
    ]);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("falls back to today+30 and a cadence-derived end when the campaign has no start", async () => {
    getCampaignById.mockResolvedValue(campaign({ version: 2, flight: { mode: "preset", preset: "asap" } }));

    const res = await POST(post() as never);
    expect(res.status).toBe(200);

    const deal = createDeal.mock.calls[0][0];
    expect(deal.flight_start).toBe("2026-07-01");
    expect(deal.flight_end).toBe("2026-07-15");
    expect(deal.status).toBe("planning");
    expect(createIO.mock.calls[0][0].status).toBe("draft");
    expect(updateDeal).not.toHaveBeenCalled();
  });

  function surfaceRow(
    id: string,
    over: { show_id?: string; published?: boolean; price?: number | null; type?: "newsletter" | "x" } = {}
  ) {
    return {
      id,
      show_id: over.show_id ?? "show-1",
      type: over.type ?? "newsletter",
      audience_size: 4000,
      format: "Friday send",
      min_buy: 20000,
      creative_constraints: null,
      lead_time_days: 7,
      posting_owner: "creator" as const,
      price: over.price === undefined ? 500 : over.price,
      notes: null,
      published: over.published ?? true,
    };
  }

  it("adds a priced surface onto the same IO and leaves an unpriced one off", async () => {
    const surfaceId = "11111111-1111-4111-8111-111111111111";
    const quoteId = "22222222-2222-4222-8222-222222222222";
    fetchSurfaceAttachment.mockResolvedValue({
      ok: true,
      surfaces: [
        surfaceRow(surfaceId),
        surfaceRow(quoteId, { type: "x", price: null }),
      ],
      shows: [{ id: "show-1", name: "Daily Briefing", platform: "podcast" }],
    });
    const row = campaign({ version: 2, flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-10-15" } });
    row.media_plan.line_items = [
      {
        podcast_id: "pod-1",
        placement: "mid-roll",
        num_episodes: 3,
        addon_surface_ids: [surfaceId, quoteId],
      } as (typeof row.media_plan.line_items)[number] & { addon_surface_ids: string[] },
    ];
    getCampaignById.mockResolvedValue(row);

    const res = await POST(post() as never);
    expect(res.status).toBe(200);
    const [, lineItems] = createIO.mock.calls[0];
    expect(lineItems).toHaveLength(4);
    expect(lineItems[3]).toEqual(
      expect.objectContaining({
        show_surface_id: surfaceId,
        price_type: "flat_rate",
        gross_rate: 500,
        spot_format: expect.stringContaining("Newsletter mention"),
      })
    );
    expect(lineItems.map((li: { show_surface_id?: string }) => li.show_surface_id).filter(Boolean)).toEqual([
      surfaceId,
    ]);
    const body = await res.json();
    expect(body.errors.join(" ")).toContain("X post needs a price");
    expect(fetchSurfaceAttachment).toHaveBeenCalledWith("show-1", [surfaceId, quoteId]);
  });

  it("returns invalid_surface and writes no deal when the surface is on another show", async () => {
    const surfaceId = "11111111-1111-4111-8111-111111111111";
    fetchSurfaceAttachment.mockResolvedValue({
      ok: true,
      surfaces: [surfaceRow(surfaceId, { show_id: "other-show" })],
      shows: [
        { id: "show-1", name: "Daily Briefing", platform: "podcast" },
        { id: "other-show", name: "Someone Else", platform: "podcast" },
      ],
    });
    const row = campaign({ version: 2, flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-10-15" } });
    row.scored_shows.push({
      ...row.scored_shows[0],
      podcastId: "pod-2",
      name: "Other Hour",
    });
    row.media_plan.line_items = [
      { podcast_id: "pod-1", placement: "mid-roll", num_episodes: 1 },
      {
        podcast_id: "pod-2",
        placement: "mid-roll",
        num_episodes: 1,
        addon_surface_ids: [surfaceId],
      } as (typeof row.media_plan.line_items)[number] & { addon_surface_ids: string[] },
    ];
    getCampaignById.mockResolvedValue(row);

    const res = await POST(post() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_surface" });
    expect(createDeal).not.toHaveBeenCalled();
    expect(createIO).not.toHaveBeenCalled();
  });

  it("returns invalid_surface and writes no deal when the surface is unpublished", async () => {
    const surfaceId = "11111111-1111-4111-8111-111111111111";
    fetchSurfaceAttachment.mockResolvedValue({
      ok: true,
      surfaces: [surfaceRow(surfaceId, { published: false })],
      shows: [{ id: "show-1", name: "Daily Briefing", platform: "podcast" }],
    });
    const row = campaign({ version: 2, flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-10-15" } });
    row.media_plan.line_items = [
      {
        podcast_id: "pod-1",
        placement: "mid-roll",
        num_episodes: 3,
        addon_surface_ids: [surfaceId],
      } as (typeof row.media_plan.line_items)[number] & { addon_surface_ids: string[] },
    ];
    getCampaignById.mockResolvedValue(row);

    const res = await POST(post() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_surface" });
    expect(createDeal).not.toHaveBeenCalled();
    expect(createIO).not.toHaveBeenCalled();
  });
});
