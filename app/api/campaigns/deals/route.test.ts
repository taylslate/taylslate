import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, ensureProfile, addDeals, createShow, createCampaign } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  ensureProfile: vi.fn(),
  addDeals: vi.fn(),
  createShow: vi.fn(),
  createCampaign: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  ensureProfile: (...a: unknown[]) => ensureProfile(...a),
  addDeals: (...a: unknown[]) => addDeals(...a),
  createShow: (...a: unknown[]) => createShow(...a),
  createCampaign: (...a: unknown[]) => createCampaign(...a),
}));

import { POST } from "./route";

function podcast(overrides: Record<string, unknown> = {}) {
  return {
    show_id: "show-1",
    show_name: "Daily Briefing",
    platform: "podcast",
    fit_score: 80,
    estimated_cpm: 25,
    audience_size: 10000,
    categories: ["business"],
    current_sponsors: [],
    allocated_budget: 750,
    num_episodes: 3,
    placement: "mid-roll",
    estimated_impressions: 30000,
    overlap_flag: false,
    overlap_with: [],
    contact_email: "host@show.test",
    ...overrides,
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/campaigns/deals", {
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
  ensureProfile.mockResolvedValue({ id: "user-1" });
  createCampaign.mockResolvedValue({ id: "camp-1" });
  addDeals.mockImplementation(async (rows: unknown[]) => rows);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/campaigns/deals flight dates", () => {
  it("puts deals on the campaign flight when the brief has dates", async () => {
    const res = await POST(
      post({
        campaign_name: "Fall",
        brief: {
          version: 2,
          flight: { mode: "dates", start_date: "2026-09-01", end_date: "2026-10-15" },
        },
        recommendations: [podcast()],
        youtube_recommendations: [
          {
            show_id: "yt-1",
            show_name: "Long Form",
            platform: "youtube",
            fit_score: 70,
            audience_size: 50000,
            categories: [],
            current_sponsors: [],
            allocated_budget: 4000,
            flat_fee_per_video: 2000,
            num_videos: 2,
            estimated_views: 100000,
            overlap_flag: false,
            overlap_with: [],
            contact_email: "yt@show.test",
          },
        ],
      }) as never
    );

    expect(res.status).toBe(200);
    const flights = addDeals.mock.calls.map((call) => {
      const row = (call[0] as { flight_start: string; flight_end: string }[])[0];
      return { flight_start: row.flight_start, flight_end: row.flight_end };
    });
    expect(flights).toEqual([
      { flight_start: "2026-09-01", flight_end: "2026-10-15" },
      { flight_start: "2026-09-01", flight_end: "2026-10-15" },
    ]);
    expect(addDeals.mock.calls[0][0][0].status).toBe("planning");
  });

  it("falls back to today+30 and a cadence-derived end when the brief has no start", async () => {
    const res = await POST(
      post({
        campaign_name: "No dates",
        brief: { version: 2 },
        recommendations: [podcast({ num_episodes: 3 })],
        youtube_recommendations: [],
      }) as never
    );

    expect(res.status).toBe(200);
    const row = addDeals.mock.calls[0][0][0];
    expect(row.flight_start).toBe("2026-07-01");
    expect(row.flight_end).toBe("2026-07-15");
    expect(row.status).toBe("planning");
  });
});
