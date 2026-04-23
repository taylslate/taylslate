import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthenticatedUser = vi.fn();
const ensureProfile = vi.fn();
const getShowProfileByUserId = vi.fn();
const upsertShowProfile = vi.fn();
const completeShowProfile = vi.fn();
const lookupShowByUrl = vi.fn();
const getPodscanClientSafe = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  ensureProfile: (...args: unknown[]) => ensureProfile(...args),
  getShowProfileByUserId: (...args: unknown[]) => getShowProfileByUserId(...args),
  upsertShowProfile: (...args: unknown[]) => upsertShowProfile(...args),
  completeShowProfile: (...args: unknown[]) => completeShowProfile(...args),
}));

vi.mock("@/lib/podscan", () => ({
  getPodscanClientSafe: (...args: unknown[]) => getPodscanClientSafe(...args),
}));
vi.mock("@/lib/podscan/lookup", () => ({
  lookupShowByUrl: (...args: unknown[]) => lookupShowByUrl(...args),
}));

import { GET, PUT, sanitizeShowProfilePatch } from "./route";
import { POST as COMPLETE_POST } from "./complete/route";
import { POST as LOOKUP_POST } from "./lookup/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://x/api/show-profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("sanitizeShowProfilePatch", () => {
  it("accepts known string fields and trims them", () => {
    const patch = sanitizeShowProfilePatch({
      feed_url: "  https://example.com/rss  ",
      show_name: " My Show ",
      show_description: "desc",
      podscan_id: "abc123",
    });
    expect(patch.feed_url).toBe("https://example.com/rss");
    expect(patch.show_name).toBe("My Show");
    expect(patch.podscan_id).toBe("abc123");
  });

  it("collapses empty strings to null", () => {
    const patch = sanitizeShowProfilePatch({ feed_url: "  ", show_name: "" });
    expect(patch.feed_url).toBeNull();
    expect(patch.show_name).toBeNull();
  });

  it("clamps audience + episode count to non-negative integers", () => {
    const patch = sanitizeShowProfilePatch({
      audience_size: 12345.7,
      episode_count: 50,
    });
    expect(patch.audience_size).toBe(12346);
    expect(patch.episode_count).toBe(50);
  });

  it("keeps expected_cpm as a non-negative number rounded to cents", () => {
    expect(sanitizeShowProfilePatch({ expected_cpm: 28.5 }).expected_cpm).toBe(28.5);
    expect(sanitizeShowProfilePatch({ expected_cpm: 28.567 }).expected_cpm).toBe(28.57);
    expect(sanitizeShowProfilePatch({ expected_cpm: 25 }).expected_cpm).toBe(25);
    expect(sanitizeShowProfilePatch({ expected_cpm: -10 }).expected_cpm).toBe(0);
  });

  it("rejects unknown platform values", () => {
    expect(sanitizeShowProfilePatch({ platform: "television" }).platform).toBeUndefined();
    expect(sanitizeShowProfilePatch({ platform: "podcast" }).platform).toBe("podcast");
  });

  it("rejects unknown cadence values", () => {
    expect(sanitizeShowProfilePatch({ episode_cadence: "hourly" }).episode_cadence).toBeUndefined();
    expect(sanitizeShowProfilePatch({ episode_cadence: "weekly" }).episode_cadence).toBe("weekly");
  });

  it("filters, dedupes, and caps multi-selects", () => {
    const patch = sanitizeShowProfilePatch({
      ad_formats: ["host_read_baked", "junk", "host_read_baked", "dynamic_insertion"],
      placements: ["pre_roll", "mid_roll", "post_roll", "nonsense"],
      category_exclusions: ["gambling", "alcohol", "none"],
    });
    expect(patch.ad_formats).toEqual(["host_read_baked", "dynamic_insertion"]);
    expect(patch.placements).toEqual(["pre_roll", "mid_roll", "post_roll"]);
    expect(patch.category_exclusions).toEqual(["gambling", "alcohol", "none"]);
  });

  it("accepts ad_copy_email and billing_email and trims them", () => {
    const patch = sanitizeShowProfilePatch({
      ad_copy_email: "  ads@show.com  ",
      billing_email: "billing@show.com",
    });
    expect(patch.ad_copy_email).toBe("ads@show.com");
    expect(patch.billing_email).toBe("billing@show.com");
  });

  it("collapses empty contact emails to null (use signing email fallback)", () => {
    const patch = sanitizeShowProfilePatch({
      ad_copy_email: "   ",
      billing_email: "",
    });
    expect(patch.ad_copy_email).toBeNull();
    expect(patch.billing_email).toBeNull();
  });

  it("ignores unknown keys entirely", () => {
    const patch = sanitizeShowProfilePatch({
      drop_database: true,
      user_id: "attacker",
      id: "malicious",
      onboarded_at: "2026-01-01",
    } as Record<string, unknown>);
    expect(patch).toEqual({});
  });
});

describe("GET /api/show-profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the user's show profile", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "u@x.co" });
    ensureProfile.mockResolvedValue({});
    getShowProfileByUserId.mockResolvedValue({ id: "sp1", user_id: "u1", show_name: "hi" });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.show_profile.id).toBe("sp1");
  });
});

describe("PUT /api/show-profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await PUT(jsonRequest({}) as never);
    expect(res.status).toBe(401);
  });

  it("sanitizes body before upserting and never passes through unknown keys", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "u@x.co" });
    ensureProfile.mockResolvedValue({});
    upsertShowProfile.mockResolvedValue({ id: "sp1", user_id: "u1", show_name: "Saunas" });

    const res = await PUT(
      jsonRequest({
        show_name: "Saunas",
        platform: "malicious", // rejected
        onboarded_at: "2026-01-01", // rejected
        audience_size: 12000,
      }) as never
    );

    expect(res.status).toBe(200);
    const call = upsertShowProfile.mock.calls[0];
    expect(call[0]).toBe("u1");
    expect(call[1]).toEqual({ show_name: "Saunas", audience_size: 12000 });
  });
});

describe("POST /api/show-profile/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await COMPLETE_POST();
    expect(res.status).toBe(401);
  });

  it("returns 400 when there is no profile", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getShowProfileByUserId.mockResolvedValue(null);
    const res = await COMPLETE_POST();
    expect(res.status).toBe(400);
  });

  it("returns 400 and lists missing required fields", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getShowProfileByUserId.mockResolvedValue({
      id: "sp1",
      user_id: "u1",
      show_name: "",
      ad_formats: [],
      placements: [],
    });
    const res = await COMPLETE_POST();
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.missing).toEqual(
      expect.arrayContaining(["show_name", "platform", "episode_cadence", "audience_size", "ad_formats", "placements"])
    );
  });

  it("completes when minimum fields are present", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getShowProfileByUserId.mockResolvedValue({
      id: "sp1",
      user_id: "u1",
      show_name: "My Show",
      platform: "podcast",
      episode_cadence: "weekly",
      audience_size: 10000,
      ad_formats: ["host_read_baked"],
      placements: ["mid_roll"],
    });
    completeShowProfile.mockResolvedValue({
      id: "sp1",
      user_id: "u1",
      onboarded_at: "2026-04-22T00:00:00Z",
    });
    const res = await COMPLETE_POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.show_profile.onboarded_at).toBeTruthy();
  });
});

function lookupReq(body: unknown): Request {
  return new Request("http://x/api/show-profile/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/show-profile/lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await LOOKUP_POST(lookupReq({ url: "feeds.example.com/rss" }) as never);
    expect(res.status).toBe(401);
  });

  it("returns found:false when Podscan is unavailable", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getPodscanClientSafe.mockReturnValue(null);
    const res = await LOOKUP_POST(lookupReq({ url: "feeds.example.com/rss" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it("returns found:false (not 500) when Podscan throws", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getPodscanClientSafe.mockReturnValue({});
    lookupShowByUrl.mockRejectedValue(new Error("podscan down"));
    const res = await LOOKUP_POST(lookupReq({ url: "feeds.example.com/rss" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it("flattens the Podscan response into the onboarding shape", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getPodscanClientSafe.mockReturnValue({});
    lookupShowByUrl.mockResolvedValue({
      podcast_id: "p1",
      podcast_name: "My Show",
      podcast_description: "desc",
      podcast_image_url: "https://img/x.jpg",
      podcast_categories: ["Business", { category_id: "c1", category_name: "Tech" }],
      episode_count: 42,
      reach: { audience_size: 12500, email: null, website: null, social_links: [], itunes: [], spotify: [] },
    });
    const res = await LOOKUP_POST(lookupReq({ url: "feeds.example.com/rss" }) as never);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.podcast).toEqual({
      podscan_id: "p1",
      show_name: "My Show",
      show_description: "desc",
      show_image_url: "https://img/x.jpg",
      show_categories: ["Business", "Tech"],
      episode_count: 42,
      audience_size: 12500,
    });
  });

  it("strips HTML tags from the podcast description before returning", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getPodscanClientSafe.mockReturnValue({});
    lookupShowByUrl.mockResolvedValue({
      podcast_id: "p1",
      podcast_name: "My Show",
      podcast_description:
        "<p>Interviews with <strong>builders</strong>.</p><p>New episodes every week.</p>",
      podcast_image_url: null,
      podcast_categories: [],
      episode_count: 10,
      reach: null,
    });
    const res = await LOOKUP_POST(lookupReq({ url: "https://feeds.example.com/rss" }) as never);
    const body = await res.json();
    expect(body.podcast.show_description).toBe(
      "Interviews with builders. New episodes every week."
    );
  });
});
