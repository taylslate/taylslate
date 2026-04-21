import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase + queries modules before importing the route so the route
// picks up the mocks (import hoisting via vi.mock).
const getAuthenticatedUser = vi.fn();
const ensureProfile = vi.fn();
const getBrandProfileByUserId = vi.fn();
const upsertBrandProfile = vi.fn();
const completeBrandProfile = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  ensureProfile: (...args: unknown[]) => ensureProfile(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  upsertBrandProfile: (...args: unknown[]) => upsertBrandProfile(...args),
  completeBrandProfile: (...args: unknown[]) => completeBrandProfile(...args),
}));

import {
  GET,
  PUT,
  sanitizeBrandProfilePatch,
} from "./route";
import { POST as COMPLETE_POST } from "./complete/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe("sanitizeBrandProfilePatch", () => {
  it("accepts known string fields and trims them", () => {
    const patch = sanitizeBrandProfilePatch({
      brand_identity: "  SaunaBox makes saunas  ",
      brand_website: "https://saunabox.com",
      target_customer: "Men 30-45",
      exclusions: "no gambling",
    });
    expect(patch.brand_identity).toBe("SaunaBox makes saunas");
    expect(patch.brand_website).toBe("https://saunabox.com");
    expect(patch.target_customer).toBe("Men 30-45");
    expect(patch.exclusions).toBe("no gambling");
  });

  it("collapses empty strings to null so the DB clears them", () => {
    const patch = sanitizeBrandProfilePatch({
      brand_identity: "   ",
      exclusions: "",
    });
    expect(patch.brand_identity).toBeNull();
    expect(patch.exclusions).toBeNull();
  });

  it("clamps age bounds and rounds floats", () => {
    const patch = sanitizeBrandProfilePatch({
      target_age_min: 12.6,
      target_age_max: 200,
    });
    expect(patch.target_age_min).toBe(13); // clamped up to floor
    expect(patch.target_age_max).toBe(120); // clamped down to ceiling
  });

  it("rejects unknown gender values", () => {
    const patch = sanitizeBrandProfilePatch({ target_gender: "sometimes" });
    expect(patch.target_gender).toBeUndefined();
  });

  it("accepts the four valid gender values", () => {
    for (const g of ["mostly_men", "mostly_women", "mixed", "no_preference"] as const) {
      expect(sanitizeBrandProfilePatch({ target_gender: g }).target_gender).toBe(g);
    }
  });

  it("rejects unknown campaign goals", () => {
    const patch = sanitizeBrandProfilePatch({ campaign_goal: "world_domination" });
    expect(patch.campaign_goal).toBeUndefined();
  });

  it("caps content_categories to 10 and filters junk", () => {
    const patch = sanitizeBrandProfilePatch({
      content_categories: ["a", "b", "", null, 42, "c", "d", "e", "f", "g", "h", "i", "j", "k", "overflow"],
    });
    expect(patch.content_categories).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
  });

  it("ignores unknown keys entirely", () => {
    const patch = sanitizeBrandProfilePatch({
      drop_database: true,
      user_id: "attacker",
      id: "malicious",
    } as Record<string, unknown>);
    expect(patch).toEqual({});
  });
});

describe("GET /api/brand-profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the current user's brand profile", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "u@x.co" });
    ensureProfile.mockResolvedValue({});
    getBrandProfileByUserId.mockResolvedValue({ id: "bp1", user_id: "u1", brand_identity: "hi" });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.brand_profile.id).toBe("bp1");
    expect(getBrandProfileByUserId).toHaveBeenCalledWith("u1");
  });
});

describe("PUT /api/brand-profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await PUT(jsonRequest("http://x/api/brand-profile", {}));
    expect(res.status).toBe(401);
  });

  it("sanitizes body before upserting", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "u@x.co" });
    ensureProfile.mockResolvedValue({});
    upsertBrandProfile.mockResolvedValue({ id: "bp1", user_id: "u1", brand_identity: "Saunas" });

    const res = await PUT(jsonRequest("http://x/api/brand-profile", {
      brand_identity: "Saunas",
      drop_database: true,     // not on whitelist
      target_gender: "bad",    // rejected
    }));

    expect(res.status).toBe(200);
    const call = upsertBrandProfile.mock.calls[0];
    expect(call[0]).toBe("u1");
    expect(call[1]).toEqual({ brand_identity: "Saunas" });
  });

  it("returns 500 when upsert fails", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "u@x.co" });
    ensureProfile.mockResolvedValue({});
    upsertBrandProfile.mockResolvedValue(null);

    const res = await PUT(jsonRequest("http://x/api/brand-profile", { brand_identity: "x" }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/brand-profile/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await COMPLETE_POST();
    expect(res.status).toBe(401);
  });

  it("returns 400 when there is no brand profile yet", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue(null);
    const res = await COMPLETE_POST();
    expect(res.status).toBe(400);
  });

  it("returns 400 and lists missing required fields", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue({
      id: "bp1",
      user_id: "u1",
      brand_identity: "",
      target_customer: "",
      content_categories: [],
    });
    const res = await COMPLETE_POST();
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.missing).toEqual(expect.arrayContaining(["brand_identity", "target_customer", "content_categories"]));
  });

  it("calls completeBrandProfile when minimum fields are present", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    getBrandProfileByUserId.mockResolvedValue({
      id: "bp1",
      user_id: "u1",
      brand_identity: "Saunas",
      target_customer: "Men 30-45",
      content_categories: ["Health & Wellness"],
    });
    completeBrandProfile.mockResolvedValue({
      id: "bp1",
      user_id: "u1",
      onboarded_at: "2026-04-21T00:00:00Z",
    });

    const res = await COMPLETE_POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.brand_profile.onboarded_at).toBeTruthy();
    expect(completeBrandProfile).toHaveBeenCalledWith("u1");
  });
});
