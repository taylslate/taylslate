import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { Show } from "@/lib/data/types";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "user-1";
const OLD = "2026-11-01T00:00:00.000Z";
const RESULT_KEYS = [
  "key",
  "name",
  "platform",
  "audienceSize",
  "categories",
  "imageUrl",
  "origin",
  "inPlan",
];

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getUserProfile: vi.fn(),
  getCampaignById: vi.fn(),
  getShowsFiltered: vi.fn(),
  createShow: vi.fn(),
  fullShowIdsForCaller: vi.fn(),
  getPodscanClientSafe: vi.fn(),
  searchPodcasts: vi.fn(),
  enforceRules: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
  getUserProfile: (...args: unknown[]) => mocks.getUserProfile(...args),
  getCampaignById: (...args: unknown[]) => mocks.getCampaignById(...args),
  getShowsFiltered: (...args: unknown[]) => mocks.getShowsFiltered(...args),
  createShow: (...args: unknown[]) => mocks.createShow(...args),
}));

vi.mock("@/lib/shows/public-fields", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shows/public-fields")>(
    "@/lib/shows/public-fields"
  );
  return {
    ...actual,
    fullShowIdsForCaller: (...args: unknown[]) => mocks.fullShowIdsForCaller(...args),
  };
});

vi.mock("@/lib/podscan/client", () => ({
  getPodscanClientSafe: () => mocks.getPodscanClientSafe(),
}));

vi.mock("@/lib/podscan/search", () => ({
  searchPodcasts: (...args: unknown[]) => mocks.searchPodcasts(...args),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRules: (...args: unknown[]) => mocks.enforceRules(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: vi.fn() }),
}));

import { GET } from "./route";

function show(over: Partial<Show> = {}): Show {
  return {
    id: SHOW_ID,
    name: "Acquired",
    platform: "podcast",
    description: "secret-db-text",
    image_url: "https://img.example/acquired.jpg",
    categories: ["Business"],
    tags: [],
    contact: { name: "Ben", email: "secret-db-text@show.test", method: "email" },
    audience_size: 200000,
    demographics: {},
    audience_interests: [],
    rate_card: { midroll_cpm: 40 },
    price_type: "cpm",
    min_buy: 500,
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 60,
    current_sponsors: [],
    is_claimed: true,
    is_verified: true,
    is_discoverable: true,
    podscan_id: "pd_Acquired1",
    data_sources: ["onboarding"],
    created_at: OLD,
    updated_at: OLD,
    ...over,
  };
}

function call(q?: string) {
  const url = new URL(`https://www.taylslate.com/api/campaigns/${CAMP}/show-search`);
  if (q !== undefined) url.searchParams.set("q", q);
  return GET(new NextRequest(url), { params: Promise.resolve({ id: CAMP }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({
    id: USER,
    email: "secret-db-text@brand.test",
  });
  mocks.getUserProfile.mockResolvedValue({ id: USER, role: "brand" });
  mocks.getCampaignById.mockResolvedValue({
    id: CAMP,
    user_id: USER,
    selected_show_ids: [],
    scored_shows: [],
    updated_at: OLD,
  });
  mocks.enforceRules.mockResolvedValue(null);
  mocks.getShowsFiltered.mockResolvedValue([]);
  mocks.fullShowIdsForCaller.mockResolvedValue(new Set());
  mocks.getPodscanClientSafe.mockReturnValue({ get: vi.fn() });
  mocks.searchPodcasts.mockResolvedValue({ podcasts: [] });
});

describe("GET /api/campaigns/[id]/show-search", () => {
  it("returns 401 without a session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const res = await call("Acquired");
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.getCampaignById).not.toHaveBeenCalled();
    expect(mocks.enforceRules).not.toHaveBeenCalled();
  });

  it.each(["show", "agent"])("returns 403 for a %s role", async (role) => {
    mocks.getUserProfile.mockResolvedValue({ id: USER, role });
    const res = await call("Acquired");
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mocks.getCampaignById).not.toHaveBeenCalled();
    expect(mocks.getShowsFiltered).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's campaign and does not search", async () => {
    mocks.getCampaignById.mockResolvedValue({
      id: CAMP,
      user_id: "someone-else",
      selected_show_ids: [SHOW_ID],
    });
    const res = await call("Acquired");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getShowsFiltered).not.toHaveBeenCalled();
    expect(mocks.searchPodcasts).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain("secret-db-text");
    expect(JSON.parse(text)).toEqual({ error: "Not found." });
  });

  it.each(["a", "a".repeat(101)])("returns 400 for q %s", async (q) => {
    const res = await call(q);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter 2 to 100 characters." });
    expect(mocks.enforceRules).not.toHaveBeenCalled();
    expect(mocks.getShowsFiltered).not.toHaveBeenCalled();
  });

  it("returns 400 when q is missing", async () => {
    const res = await call();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter 2 to 100 characters." });
  });

  it("returns 429 when a search rule denies the call", async () => {
    mocks.enforceRules.mockResolvedValue(
      NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    );
    const res = await call("Acquired");
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(mocks.getShowsFiltered).not.toHaveBeenCalled();
    expect(mocks.enforceRules).toHaveBeenCalledWith({
      failureMode: "closed",
      rules: [
        { bucket: "disc_search_user_min", key: USER, max: 20, windowSeconds: 60 },
        {
          bucket: "disc_search_user_day",
          key: USER,
          max: 300,
          windowSeconds: 24 * 60 * 60,
        },
      ],
    });
  });

  it("returns 503 when the rate limit store errors", async () => {
    mocks.enforceRules.mockResolvedValue(
      NextResponse.json({ error: "unavailable" }, { status: 503 })
    );
    const res = await call("Acquired");
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(mocks.getShowsFiltered).not.toHaveBeenCalled();
  });

  it("returns the public shape, inPlan, and no-store", async () => {
    mocks.getUserProfile.mockResolvedValue({ id: USER, role: "agency" });
    mocks.getCampaignById.mockResolvedValue({
      id: CAMP,
      user_id: USER,
      selected_show_ids: [SHOW_ID],
    });
    mocks.fullShowIdsForCaller.mockResolvedValue(new Set([SHOW_ID]));
    mocks.getShowsFiltered.mockResolvedValue([show()]);
    const res = await call("Acquired");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.podscanAvailable).toBe(true);
    expect(Object.keys(body.results[0])).toEqual(RESULT_KEYS);
    expect(body.results[0].inPlan).toBe(true);
    expect(body.results[0].key).toBe(`show:${SHOW_ID}`);
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret-db-text");
    expect(text).not.toContain("rate_card");
    expect(text).not.toContain("description");
    expect(mocks.getUserProfile).toHaveBeenCalledWith(USER);
  });

  it("does not put catalog or Podscan error text in the body", async () => {
    mocks.getShowsFiltered.mockRejectedValue(new Error("secret-db-text"));
    const res = await call("Acquired");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Search failed. Try again." });
    expect(JSON.stringify(body)).not.toContain("secret-db-text");
  });
});
