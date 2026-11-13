// @vitest-environment jsdom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Show } from "@/lib/data/types";
import { sanitizeShowSearch } from "@/app/(dashboard)/shows/search/search-client";
import MediaPlanBuilder from "@/app/(dashboard)/campaigns/[id]/plan/media-plan-builder";
import { podscanPodcastToShow } from "@/lib/discovery/format-discovered-show";
import type { PodscanPodcast } from "@/lib/podscan/types";

const SHOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "user-1";
const OLD = "2026-11-01T00:00:00.000Z";
const PUBLIC_KEYS = [
  "key",
  "name",
  "platform",
  "audienceSize",
  "categories",
  "imageUrl",
  "origin",
];

const mocks = vi.hoisted(() => ({
  getShowsFiltered: vi.fn(),
  createShow: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getCampaignById: vi.fn(),
  getUserProfile: vi.fn(),
  fullShowIdsForCaller: vi.fn(),
  getPodscanClientSafe: vi.fn(),
  searchPodcasts: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowsFiltered: (...args: unknown[]) => mocks.getShowsFiltered(...args),
  createShow: (...args: unknown[]) => mocks.createShow(...args),
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
  getCampaignById: (...args: unknown[]) => mocks.getCampaignById(...args),
  getUserProfile: (...args: unknown[]) => mocks.getUserProfile(...args),
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (...args: unknown[]) => mocks.from(...args) }),
}));

import {
  PLAN_SHOW_CAP,
  appendShowToPlan,
  sanitizeDirectSearch,
  searchShowsByName,
  toSearchedScoredShowRecord,
} from "./direct-search";

function makeShow(over: Partial<Show> = {}): Show {
  return {
    id: SHOW_ID,
    name: "Acquired",
    platform: "podcast",
    description: "secret-db-text",
    image_url: "https://img.example/acquired.jpg",
    categories: ["Business", "Tech", "Investing", "Startups", "News", "Extra"],
    tags: [],
    contact: { name: "Ben", email: "secret-db-text@show.test", method: "email" },
    audience_size: 200000,
    demographics: {},
    audience_interests: [],
    rate_card: { midroll_cpm: 40, preroll_cpm: 25, postroll_cpm: 18 },
    price_type: "cpm",
    min_buy: 500,
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 60,
    current_sponsors: ["secret-db-text sponsor"],
    network: "Acquired Media",
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

function podcast(over: Partial<PodscanPodcast> = {}): PodscanPodcast {
  return {
    podcast_id: "pd_Other999",
    podcast_name: "Other Show",
    podcast_description: "secret-db-text",
    podcast_categories: [{ category_id: "c1", category_name: "Comedy" }],
    podcast_image_url: "https://img.example/other.jpg",
    publisher_name: "Other Publisher",
    reach: {
      audience_size: 100000,
      email: "secret-db-text@podscan.test",
      website: null,
      social_links: [],
      itunes: [],
      spotify: { spotify_rating_average: null },
    },
    ...over,
  };
}

type Filter = { col: string; val: unknown };
let planRow: {
  scored_shows: unknown[];
  selected_show_ids: string[];
  updated_at: string;
};
let updateResult: { data: unknown; error: { message?: string; code?: string } | null };
let lastUpdate: { payload: Record<string, unknown>; filters: Filter[] } | null;
let updateCount: number;

function installPlan() {
  planRow = { scored_shows: [], selected_show_ids: [], updated_at: OLD };
  updateResult = { data: [{ id: CAMP }], error: null };
  lastUpdate = null;
  updateCount = 0;
  mocks.from.mockImplementation((table: string) => {
    const state = { op: "select", payload: null as unknown, filters: [] as Filter[] };
    const api = {
      select() {
        return api;
      },
      update(payload: unknown) {
        state.op = "update";
        state.payload = payload;
        return api;
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, val });
        return api;
      },
      maybeSingle() {
        return Promise.resolve(finish(table, state));
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(finish(table, state)).then(resolve, reject);
      },
    };
    return api;
  });
}

function finish(table: string, state: { op: string; payload: unknown; filters: Filter[] }) {
  if (table !== "campaigns" || state.op !== "update") {
    return { data: planRow, error: null };
  }
  updateCount += 1;
  lastUpdate = { payload: state.payload as Record<string, unknown>, filters: state.filters };
  return updateResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPodscanClientSafe.mockReturnValue({ get: vi.fn() });
  mocks.searchPodcasts.mockResolvedValue({ podcasts: [] });
  mocks.getShowsFiltered.mockResolvedValue([]);
  mocks.fullShowIdsForCaller.mockResolvedValue(new Set());
  installPlan();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sanitizeDirectSearch", () => {
  const inputs = [
    "Acquired",
    "  Acquired  ",
    "100%",
    "a_b",
    "a\\b",
    "foo*bar",
    "*wild",
    "%%__",
    "mix % _ \\ * end",
  ];

  it("matches sanitizeShowSearch once the query is at least 2 characters", () => {
    for (const input of inputs) {
      expect(sanitizeDirectSearch(input)).toBe(sanitizeShowSearch(input));
    }
  });

  it("requires 2 characters after the trim", () => {
    expect(sanitizeDirectSearch(" a ")).toBe("");
    expect(sanitizeDirectSearch("%")).toBe("");
    expect(sanitizeDirectSearch("")).toBe("");
  });

  it("escapes % _ and \\ so they cannot widen a catalog match, and keeps * literal", () => {
    const raw = "100%_\\*";
    const sanitized = sanitizeDirectSearch(raw);
    expect(sanitized).toBe(sanitizeShowSearch(raw));
    const plain = sanitized.replace(/\\([\\%_])/g, "");
    expect(plain.includes("%")).toBe(false);
    expect(plain.includes("_")).toBe(false);
    expect(plain.includes("\\")).toBe(false);
    expect(sanitized.includes("*")).toBe(true);
  });
});

describe("searchShowsByName", () => {
  it("sends the escaped string to the catalog and the typed name to Podscan", async () => {
    await searchShowsByName(USER, "100%_off");
    expect(mocks.getShowsFiltered).toHaveBeenCalledWith({
      search: sanitizeShowSearch("100%_off"),
      limit: 10,
    });
    expect(mocks.searchPodcasts).toHaveBeenCalledWith(expect.anything(), {
      query: "100%_off",
      searchFields: "name",
      perPage: 10,
    });
  });

  it("returns the public keys only, even when the caller is tied to the show", async () => {
    const show = makeShow();
    mocks.getShowsFiltered.mockResolvedValue([show]);
    mocks.fullShowIdsForCaller.mockResolvedValue(new Set([show.id]));
    const found = await searchShowsByName(USER, "Acquired");
    expect(found.results).toHaveLength(1);
    expect(Object.keys(found.results[0])).toEqual(PUBLIC_KEYS);
    expect(found.results[0]).toMatchObject({
      key: `show:${SHOW_ID}`,
      name: "Acquired",
      platform: "podcast",
      audienceSize: 200000,
      origin: "taylslate",
      imageUrl: "https://img.example/acquired.jpg",
    });
    expect(found.results[0].categories).toEqual([
      "Business",
      "Tech",
      "Investing",
      "Startups",
      "News",
    ]);
    const body = JSON.stringify(found);
    expect(body).not.toContain("secret-db-text");
    expect(body).not.toContain("contact");
    expect(body).not.toContain("rate_card");
    expect(body).not.toContain("description");
    expect(body).not.toContain("email");
  });

  it("keeps the catalog row when Podscan returns the same podcast id", async () => {
    mocks.getShowsFiltered.mockResolvedValue([makeShow()]);
    mocks.searchPodcasts.mockResolvedValue({
      podcasts: [
        podcast({ podcast_id: "pd_Acquired1", podcast_name: "Acquired" }),
        podcast(),
      ],
    });
    const found = await searchShowsByName(USER, "Acquired");
    expect(found.podscanAvailable).toBe(true);
    expect(found.results.map((row) => row.key)).toEqual([
      `show:${SHOW_ID}`,
      "podscan:pd_Other999",
    ]);
    expect(found.results[0].origin).toBe("taylslate");
    expect(found.results[1].origin).toBe("podscan");
    expect(JSON.stringify(found)).not.toContain("secret-db-text");
  });

  it("hides Podscan when the search throws and still returns the catalog", async () => {
    mocks.getShowsFiltered.mockResolvedValue([makeShow({ podscan_id: undefined })]);
    mocks.searchPodcasts.mockRejectedValue(new Error("secret-db-text"));
    const found = await searchShowsByName(USER, "Acquired");
    expect(found.podscanAvailable).toBe(false);
    expect(found.results).toHaveLength(1);
    expect(found.results[0].origin).toBe("taylslate");
    expect(JSON.stringify(found)).not.toContain("secret-db-text");
  });

  it("hides Podscan when the client is missing", async () => {
    mocks.getPodscanClientSafe.mockReturnValue(null);
    mocks.getShowsFiltered.mockResolvedValue([makeShow({ podscan_id: undefined })]);
    const found = await searchShowsByName(USER, "Acquired");
    expect(found.podscanAvailable).toBe(false);
    expect(found.results).toHaveLength(1);
    expect(mocks.searchPodcasts).not.toHaveBeenCalled();
  });

  it("throws a fixed error when the catalog throws", async () => {
    mocks.getShowsFiltered.mockRejectedValue(new Error("secret-db-text"));
    await expect(searchShowsByName(USER, "Acquired")).rejects.toThrow(
      "Search failed. Try again."
    );
  });
});

describe("toSearchedScoredShowRecord", () => {
  it("prices a catalog show with an onboarded rate card as a real base CPM", () => {
    const record = toSearchedScoredShowRecord(makeShow());
    expect(record.source).toBe("search");
    expect(record.podcastId).toBe(SHOW_ID);
    expect(record.estimatedCpm).toBe(40);
    expect(record.costIsEstimate).toBe(false);
    expect(record.audienceIsEstimate).toBe(false);
    expect(record.placement).toBeUndefined();
    expect(record.compositeScore).toBe(0);
    expect(record.dimensionScores).toEqual({
      audienceFit: null,
      adEngagement: null,
      sponsorRetention: null,
      reach: 0,
    });
    expect(record.contactEmail).toBeNull();
    expect(record.description).toBe("");
  });

  it("marks a Podscan show as an estimate and falls back to the default rate card", () => {
    const draft = podscanPodcastToShow({
      podcast_id: "pd_Other999",
      podcast_name: "Other Show",
      podcast_description: "secret-db-text",
      podcast_categories: ["Comedy"],
      reach: { audience_size: 100000, email: "secret-db-text@podscan.test" },
    });
    const show: Show = {
      ...draft,
      id: SHOW_ID,
      data_sources: ["direct_search"],
      is_claimed: false,
      is_verified: false,
    };
    const record = toSearchedScoredShowRecord(show);
    expect(record.source).toBe("search");
    expect(record.podcastId).toBe(SHOW_ID);
    expect(record.estimatedCpm).toBe(28);
    expect(record.costIsEstimate).toBe(true);
    expect(record.audienceIsEstimate).toBe(true);
    expect(record.contactEmail).toBeNull();
    expect(JSON.stringify(record)).not.toContain("secret-db-text");
  });

  it("lets the media plan builder price the record", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    );
    const record = toSearchedScoredShowRecord(makeShow());
    render(
      createElement(MediaPlanBuilder, {
        campaignId: CAMP,
        campaignName: "Fall test",
        budgetTotal: 30000,
        selectedShows: [record],
        initialPlan: null,
      })
    );
    const line = `$${Math.round((200000 / 1000) * 40 * 3).toLocaleString()}`;
    expect(screen.getByText("Acquired")).toBeInTheDocument();
    expect(screen.getAllByText(line).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("plan-estimate")).not.toBeInTheDocument();
  });
});

describe("appendShowToPlan", () => {
  const record = toSearchedScoredShowRecord(makeShow());

  it("writes only the plan columns, filtered on id, user id, and updated_at", async () => {
    const result = await appendShowToPlan({ id: CAMP, user_id: USER }, record);
    expect(result).toEqual({ ok: true, showId: SHOW_ID, alreadyInPlan: false });
    expect(updateCount).toBe(1);
    expect(Object.keys(lastUpdate?.payload ?? {}).sort()).toEqual([
      "scored_shows",
      "selected_show_ids",
      "updated_at",
    ]);
    expect(lastUpdate?.payload.updated_at).not.toBe(OLD);
    expect(lastUpdate?.filters).toEqual([
      { col: "id", val: CAMP },
      { col: "user_id", val: USER },
      { col: "updated_at", val: OLD },
    ]);
    const scored = lastUpdate?.payload.scored_shows as Array<{ podcastId: string; source: string }>;
    expect(scored.map((row) => row.podcastId)).toEqual([SHOW_ID]);
    expect(scored[0].source).toBe("search");
    expect(lastUpdate?.payload.selected_show_ids).toEqual([SHOW_ID]);
    expect(lastUpdate?.payload).not.toHaveProperty("media_plan");
    expect(lastUpdate?.payload).not.toHaveProperty("status");
    expect(lastUpdate?.payload).not.toHaveProperty("scoring_meta");
  });

  it("does not write when the show is already selected", async () => {
    planRow.selected_show_ids = [SHOW_ID];
    const result = await appendShowToPlan({ id: CAMP, user_id: USER }, record);
    expect(result).toEqual({ ok: true, showId: SHOW_ID, alreadyInPlan: true });
    expect(updateCount).toBe(0);
  });

  it("returns a conflict when the update matches zero rows and does not retry", async () => {
    updateResult = { data: [], error: null };
    const result = await appendShowToPlan({ id: CAMP, user_id: USER }, record);
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "The plan changed. Reload and try again.",
    });
    expect(updateCount).toBe(1);
  });

  it("returns plan full at 50 selected shows and does not write", async () => {
    planRow.selected_show_ids = Array.from({ length: PLAN_SHOW_CAP }, (_, index) => {
      const tail = String(index).padStart(12, "0");
      return `cccccccc-cccc-4ccc-8ccc-${tail}`;
    });
    const result = await appendShowToPlan({ id: CAMP, user_id: USER }, record);
    expect(result).toEqual({ ok: false, status: 409, error: "The plan is full." });
    expect(updateCount).toBe(0);
  });

  it("does not return database error text", async () => {
    updateResult = { data: null, error: { message: "secret-db-text", code: "XX000" } };
    const result = await appendShowToPlan({ id: CAMP, user_id: USER }, record);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-db-text");
  });
});
