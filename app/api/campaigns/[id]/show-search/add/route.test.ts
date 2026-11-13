import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "user-1";
const OLD = "2026-11-01T00:00:00.000Z";
const PODSCAN = "pd_Acquired1";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getUserProfile: vi.fn(),
  getCampaignById: vi.fn(),
  getShowsFiltered: vi.fn(),
  createShow: vi.fn(),
  getPodscanClientSafe: vi.fn(),
  searchPodcasts: vi.fn(),
  enforceRules: vi.fn(),
  from: vi.fn(),
  podscanGet: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
  getUserProfile: (...args: unknown[]) => mocks.getUserProfile(...args),
  getCampaignById: (...args: unknown[]) => mocks.getCampaignById(...args),
  getShowsFiltered: (...args: unknown[]) => mocks.getShowsFiltered(...args),
  createShow: (...args: unknown[]) => mocks.createShow(...args),
}));

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
  createClient: async () => ({ from: (...args: unknown[]) => mocks.from(...args) }),
}));

import { POST } from "./route";

type Filter = { col: string; val: unknown };

let showsById: Record<string, unknown> | null;
let showsByPodscan: Record<string, unknown> | null;
let showsError: { message?: string; code?: string } | null;
let planRow: {
  scored_shows: unknown[];
  selected_show_ids: string[];
  updated_at: string;
} | null;
let updateResult: { data: unknown; error: { message?: string; code?: string } | null };
let lastUpdate: { payload: Record<string, unknown>; filters: Filter[] } | null;
let updateCount: number;
let showReads: Filter[][];

function dbShow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHOW_ID,
    name: "Acquired",
    platform: "podcast",
    description: "secret-db-text",
    image_url: "https://img.example/acquired.jpg",
    categories: ["Business"],
    tags: [],
    contact_name: "Ben",
    contact_email: "secret-db-text@show.test",
    contact_method: "email",
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
    podscan_id: PODSCAN,
    data_sources: ["onboarding"],
    created_at: OLD,
    updated_at: OLD,
    ...over,
  };
}

function podcastBody(over: Record<string, unknown> = {}) {
  return {
    podcast_id: PODSCAN,
    podcast_name: "Acquired",
    podcast_description: "secret-db-text",
    podcast_categories: [{ category_id: "c1", category_name: "Business" }],
    podcast_image_url: "https://img.example/acquired.jpg",
    publisher_name: "Acquired Media",
    reach: {
      audience_size: 100000,
      email: "host@podscan.test",
      website: null,
      social_links: [],
      itunes: [],
      spotify: { spotify_rating_average: null },
    },
    ...over,
  };
}

function savedPodscanShow(over: Record<string, unknown> = {}) {
  return {
    id: NEW_ID,
    name: "Acquired",
    platform: "podcast",
    description: "secret-db-text",
    image_url: "https://img.example/acquired.jpg",
    categories: ["Business"],
    tags: [],
    contact: { name: "Acquired Media", email: "host@podscan.test", method: "email" },
    audience_size: 100000,
    demographics: {},
    audience_interests: ["Business"],
    rate_card: { preroll_cpm: 22, midroll_cpm: 28, postroll_cpm: 15 },
    price_type: "cpm",
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 45,
    current_sponsors: [],
    is_claimed: false,
    is_verified: false,
    is_discoverable: true,
    podscan_id: PODSCAN,
    data_sources: ["direct_search"],
    created_at: OLD,
    updated_at: OLD,
    ...over,
  };
}

function installDb() {
  showsById = dbShow();
  showsByPodscan = null;
  showsError = null;
  planRow = { scored_shows: [], selected_show_ids: [], updated_at: OLD };
  updateResult = { data: [{ id: CAMP }], error: null };
  lastUpdate = null;
  updateCount = 0;
  showReads = [];
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
  if (table === "shows") {
    showReads.push(state.filters);
    if (showsError) return { data: null, error: showsError };
    const discoverable = state.filters.find((filter) => filter.col === "is_discoverable");
    const id = state.filters.find((filter) => filter.col === "id")?.val;
    const podscanId = state.filters.find((filter) => filter.col === "podscan_id")?.val;
    const row = id != null ? showsById : podscanId != null ? showsByPodscan : null;
    if (!row) return { data: null, error: null };
    if (discoverable && row.is_discoverable !== discoverable.val) return { data: null, error: null };
    if (id != null && row.id !== id) return { data: null, error: null };
    if (podscanId != null && row.podscan_id !== podscanId) return { data: null, error: null };
    return { data: row, error: null };
  }
  if (table === "campaigns" && state.op === "update") {
    updateCount += 1;
    lastUpdate = { payload: state.payload as Record<string, unknown>, filters: state.filters };
    return updateResult;
  }
  return { data: planRow, error: null };
}

function post(
  body: unknown,
  init?: { raw?: string; headers?: Record<string, string> }
) {
  const headers = new Headers(init?.headers ?? { "content-type": "application/json" });
  const raw = init?.raw ?? (body === undefined ? "" : JSON.stringify(body));
  return POST(
    new NextRequest(`https://www.taylslate.com/api/campaigns/${CAMP}/show-search/add`, {
      method: "POST",
      headers,
      body: raw,
    }),
    { params: Promise.resolve({ id: CAMP }) }
  );
}

async function read(res: Response) {
  const text = await res.text();
  expect(text).not.toContain("secret-db-text");
  return { status: res.status, cache: res.headers.get("Cache-Control"), body: JSON.parse(text) as Record<string, unknown>, text };
}

beforeEach(() => {
  vi.clearAllMocks();
  installDb();
  mocks.getAuthenticatedUser.mockResolvedValue({
    id: USER,
    email: "secret-db-text@brand.test",
  });
  mocks.getUserProfile.mockResolvedValue({ id: USER, role: "brand" });
  mocks.getCampaignById.mockResolvedValue({
    id: CAMP,
    user_id: USER,
    name: "secret-db-text campaign",
    selected_show_ids: [],
    scored_shows: [],
    updated_at: OLD,
  });
  mocks.enforceRules.mockResolvedValue(null);
  mocks.getPodscanClientSafe.mockReturnValue({ get: mocks.podscanGet });
  mocks.podscanGet.mockResolvedValue(podcastBody());
  mocks.searchPodcasts.mockResolvedValue({ podcasts: [] });
  mocks.createShow.mockResolvedValue(savedPodscanShow());
});

describe("POST /api/campaigns/[id]/show-search/add", () => {
  it("returns 401 without a session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(401);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({ error: "Unauthorized" });
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.getCampaignById).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.enforceRules).not.toHaveBeenCalled();
  });

  it.each(["show", "agent"])("returns 403 for a %s role and does not read the campaign", async (role) => {
    mocks.getUserProfile.mockResolvedValue({ id: USER, role });
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(403);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({ error: "Forbidden" });
    expect(mocks.getCampaignById).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's campaign and reads nothing else", async () => {
    mocks.getCampaignById.mockResolvedValue({
      id: CAMP,
      user_id: "someone-else",
      name: "secret-db-text",
    });
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(404);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({ error: "Not found." });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.podscanGet).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
  });

  it("lets an agency account past the role gate", async () => {
    mocks.getUserProfile.mockResolvedValue({ id: USER, role: "agency" });
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.enforceRules).toHaveBeenCalled();
  });

  it("rejects a bad key before the rate limit", async () => {
    for (const key of ["nope", "podscan:nope", "podscan:pd_", `podscan:pd_${"a".repeat(41)}`, "show:not-a-uuid"]) {
      mocks.enforceRules.mockClear();
      mocks.from.mockClear();
      const res = await read(await post({ key }));
      expect(res.status).toBe(400);
      expect(res.cache).toBe("no-store");
      expect(res.body).toEqual({ error: "That show key is not valid." });
      expect(mocks.enforceRules).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.createShow).not.toHaveBeenCalled();
      expect(mocks.podscanGet).not.toHaveBeenCalled();
    }
  });

  it("rejects non-JSON, invalid JSON, a missing key, and an oversized body", async () => {
    const cases: Array<{ raw?: string; body?: unknown; headers: Record<string, string>; error: string }> = [
      { raw: "{\"key\":\"show:x\"}", headers: { "content-type": "text/plain" }, error: "Send JSON." },
      { raw: "{", headers: { "content-type": "application/json" }, error: "Send JSON." },
      { raw: "[1]", headers: { "content-type": "application/json" }, error: "Send JSON." },
      { body: {}, headers: { "content-type": "application/json" }, error: "That show key is not valid." },
      {
        body: { key: `show:${SHOW_ID}` },
        headers: { "content-type": "application/json", "content-length": "3000" },
        error: "Request is too large.",
      },
      {
        raw: `{"key":"${"x".repeat(2100)}"}`,
        headers: { "content-type": "application/json", "content-length": "nope" },
        error: "Request is too large.",
      },
    ];
    for (const item of cases) {
      mocks.enforceRules.mockClear();
      const res = await read(await post(item.body, { raw: item.raw, headers: item.headers }));
      expect(res.status).toBe(400);
      expect(res.cache).toBe("no-store");
      expect(res.body).toEqual({ error: item.error });
      expect(mocks.enforceRules).not.toHaveBeenCalled();
      expect(mocks.createShow).not.toHaveBeenCalled();
    }
  });

  it("returns 404 for a hidden show", async () => {
    showsById = dbShow({ is_discoverable: false });
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Show not found." });
    expect(showReads[0]).toEqual([
      { col: "is_discoverable", val: true },
      { col: "id", val: SHOW_ID },
    ]);
    expect(updateCount).toBe(0);
  });

  it("returns 404 for a missing show", async () => {
    showsById = null;
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Show not found." });
    expect(updateCount).toBe(0);
  });

  it("ignores name, audience, and price from the body and writes the database show", async () => {
    const res = await read(
      await post({
        key: `show:${SHOW_ID.toUpperCase()}`,
        name: "Hacked secret-db-text",
        audienceSize: 1,
        estimatedCpm: 1,
        contactEmail: "secret-db-text@evil.test",
      })
    );
    expect(res.status).toBe(200);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({ ok: true, showId: SHOW_ID, alreadyInPlan: false });
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
    const scored = lastUpdate?.payload.scored_shows as Array<Record<string, unknown>>;
    expect(scored[0]).toMatchObject({
      podcastId: SHOW_ID,
      name: "Acquired",
      source: "search",
      estimatedCpm: 40,
      description: "",
      contactEmail: null,
      costIsEstimate: false,
      audienceIsEstimate: false,
    });
    expect(scored[0].placement).toBeUndefined();
    expect(lastUpdate?.payload.selected_show_ids).toEqual([SHOW_ID]);
    expect(lastUpdate?.payload).not.toHaveProperty("media_plan");
    expect(lastUpdate?.payload).not.toHaveProperty("status");
    expect(lastUpdate?.payload).not.toHaveProperty("scoring_meta");
    expect(JSON.stringify(lastUpdate?.payload)).not.toContain("secret-db-text");
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(mocks.podscanGet).not.toHaveBeenCalled();
    expect(mocks.enforceRules).toHaveBeenCalledWith({
      failureMode: "closed",
      rules: [
        {
          bucket: "disc_search_add_user_hour",
          key: USER,
          max: 60,
          windowSeconds: 60 * 60,
        },
      ],
    });
  });

  it("uses a catalog row for a Podscan id and does not insert", async () => {
    showsById = null;
    showsByPodscan = dbShow();
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, showId: SHOW_ID, alreadyInPlan: false });
    expect(showReads[0]).toEqual([
      { col: "is_discoverable", val: true },
      { col: "podscan_id", val: PODSCAN },
    ]);
    expect(mocks.podscanGet).not.toHaveBeenCalled();
    expect(mocks.searchPodcasts).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(updateCount).toBe(1);
  });

  it("saves a new Podscan show once and prices the saved uuid", async () => {
    showsById = null;
    showsByPodscan = null;
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, showId: NEW_ID, alreadyInPlan: false });
    expect(res.text).not.toContain("host@podscan.test");
    expect(mocks.podscanGet).toHaveBeenCalledWith(`/podcasts/${PODSCAN}`);
    expect(mocks.searchPodcasts).not.toHaveBeenCalled();
    expect(mocks.createShow).toHaveBeenCalledTimes(1);
    const saved = mocks.createShow.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.is_claimed).toBe(false);
    expect(saved.is_verified).toBe(false);
    expect(saved.data_sources).toEqual(["direct_search"]);
    expect(saved).not.toHaveProperty("actor");
    expect(saved).not.toHaveProperty("id");
    expect((saved.contact as { email: string }).email).toBe("host@podscan.test");
    expect(saved.podscan_id).toBe(PODSCAN);
    const scored = lastUpdate?.payload.scored_shows as Array<Record<string, unknown>>;
    expect(scored[0].podcastId).toBe(NEW_ID);
    expect(scored[0].source).toBe("search");
    expect(scored[0].estimatedCpm).toBe(28);
    expect(scored[0].costIsEstimate).toBe(true);
    expect(scored[0].audienceIsEstimate).toBe(true);
    expect(scored[0].contactEmail).toBeNull();
    expect(scored[0].description).toBe("");
    expect(JSON.stringify(lastUpdate?.payload)).not.toContain("discovered-podscan");
    expect(JSON.stringify(lastUpdate?.payload)).not.toContain("secret-db-text");
    expect(JSON.stringify(lastUpdate?.payload)).not.toContain("host@podscan.test");
  });

  it("accepts a podcast wrapped in a podcast field", async () => {
    showsByPodscan = null;
    mocks.podscanGet.mockResolvedValue({ podcast: podcastBody() });
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(200);
    expect(res.body.showId).toBe(NEW_ID);
    expect(mocks.createShow).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the podcast get is a 404", async () => {
    showsByPodscan = null;
    mocks.podscanGet.mockRejectedValue(Object.assign(new Error("secret-db-text"), { status: 404 }));
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Show not found." });
    expect(mocks.searchPodcasts).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(updateCount).toBe(0);
  });

  it("falls back to an exact podcast id when the get is not a podcast", async () => {
    showsByPodscan = null;
    mocks.podscanGet.mockResolvedValue({ error: "secret-db-text" });
    mocks.searchPodcasts.mockResolvedValue({
      podcasts: [podcastBody(), podcastBody({ podcast_id: "pd_Other999", podcast_name: "Other" })],
    });
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(200);
    expect(mocks.searchPodcasts).toHaveBeenCalledWith(expect.anything(), {
      query: PODSCAN,
      searchFields: "name",
      perPage: 10,
    });
    expect(mocks.createShow).toHaveBeenCalledTimes(1);
    expect((mocks.createShow.mock.calls[0][0] as { podscan_id: string }).podscan_id).toBe(PODSCAN);
  });

  it("falls back when the podcast get throws a non-404 status", async () => {
    showsByPodscan = null;
    mocks.podscanGet.mockRejectedValue(Object.assign(new Error("secret-db-text"), { status: 403 }));
    mocks.searchPodcasts.mockResolvedValue({ podcasts: [podcastBody()] });
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(200);
    expect(mocks.searchPodcasts).toHaveBeenCalled();
    expect(mocks.createShow).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the Podscan client is missing", async () => {
    showsByPodscan = null;
    mocks.getPodscanClientSafe.mockReturnValue(null);
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Show not found." });
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(mocks.searchPodcasts).not.toHaveBeenCalled();
  });

  it("does not add a Podscan save that came back hidden", async () => {
    showsByPodscan = null;
    mocks.createShow.mockResolvedValue(savedPodscanShow({ is_discoverable: false }));
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Show not found." });
    expect(updateCount).toBe(0);
  });

  it("returns a fixed error when createShow returns null or throws", async () => {
    showsByPodscan = null;
    mocks.createShow.mockResolvedValueOnce(null);
    const missing = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(missing.status).toBe(500);
    expect(missing.body).toEqual({ error: "Search failed. Try again." });

    mocks.createShow.mockRejectedValueOnce(new Error("secret-db-text"));
    const thrown = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(thrown.status).toBe(500);
    expect(thrown.body).toEqual({ error: "Search failed. Try again." });
    expect(updateCount).toBe(0);
  });

  it("returns plan full before creating a show when 50 are already selected", async () => {
    showsByPodscan = null;
    planRow = {
      scored_shows: [],
      selected_show_ids: Array.from({ length: 50 }, (_, index) => {
        return `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`;
      }),
      updated_at: OLD,
    };
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "The plan is full." });
    expect(mocks.podscanGet).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(updateCount).toBe(0);
  });

  it("does not write when the show is already selected", async () => {
    planRow = {
      scored_shows: [],
      selected_show_ids: [SHOW_ID.toUpperCase()],
      updated_at: OLD,
    };
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, showId: SHOW_ID, alreadyInPlan: true });
    expect(updateCount).toBe(0);
  });

  it("returns 409 when the update matches zero rows and does not retry", async () => {
    updateResult = { data: [], error: null };
    const res = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(res.status).toBe(409);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({ error: "The plan changed. Reload and try again." });
    expect(updateCount).toBe(1);
  });

  it("hides a database error on the show read and on the plan update", async () => {
    showsError = { message: "secret-db-text", code: "XX000" };
    const readFail = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(readFail.status).toBe(500);
    expect(readFail.body).toEqual({ error: "Search failed. Try again." });

    showsError = null;
    updateResult = { data: null, error: { message: "secret-db-text", code: "XX000" } };
    const writeFail = await read(await post({ key: `show:${SHOW_ID}` }));
    expect(writeFail.status).toBe(500);
    expect(writeFail.body).toEqual({ error: "Search failed. Try again." });
    expect(writeFail.status).not.toBe(409);
  });

  it("returns 429 before any show read", async () => {
    mocks.enforceRules.mockResolvedValue(
      NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    );
    const res = await post({ key: `show:${SHOW_ID}` });
    const parsed = await read(res);
    expect(parsed.status).toBe(429);
    expect(parsed.cache).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(parsed.body).toEqual({ error: "Too many requests. Try again later." });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(mocks.enforceRules).toHaveBeenCalledWith({
      failureMode: "closed",
      rules: [
        {
          bucket: "disc_search_add_user_hour",
          key: USER,
          max: 60,
          windowSeconds: 60 * 60,
        },
      ],
    });
  });

  it("returns 503 when the rate limit store errors and does not create a show", async () => {
    mocks.enforceRules.mockResolvedValue(
      NextResponse.json({ error: "unavailable" }, { status: 503 })
    );
    const res = await read(await post({ key: `podscan:${PODSCAN}` }));
    expect(res.status).toBe(503);
    expect(res.cache).toBe("no-store");
    expect(res.body).toEqual({ error: "unavailable" });
    expect(mocks.podscanGet).not.toHaveBeenCalled();
    expect(mocks.createShow).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
