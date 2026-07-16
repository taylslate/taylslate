import { describe, it, expect, vi, beforeEach } from "vitest";

// The route marks the show profile onboarded, then — if the show arrived from a
// public pitch — reads the return cookie the magic-link landing stashed and hands
// the (sanitized) path back so the client can hard-navigate to the pitch. It
// always clears the cookie (one-shot).
const {
  getAuthenticatedUser,
  getShowProfileByUserId,
  completeShowProfile,
  cookiesGet,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getShowProfileByUserId: vi.fn(),
  completeShowProfile: vi.fn(),
  cookiesGet: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser,
  getShowProfileByUserId,
  completeShowProfile,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookiesGet, set: vi.fn() })),
}));

import { POST } from "./route";
import { ONBOARDING_RETURN_COOKIE } from "@/lib/auth/onboarding-return";

const ORIGIN = "https://www.taylslate.com";
const call = () => POST(new Request(`${ORIGIN}/api/show-profile/complete`, { method: "POST" }));

// A profile that satisfies the required-fields gate.
const completeProfile = {
  show_name: "My Show",
  platform: "podcast",
  episode_cadence: "weekly",
  audience_size: 1000,
  ad_formats: ["host_read_baked"],
  placements: ["mid_roll"],
};

beforeEach(() => {
  getAuthenticatedUser.mockReset().mockResolvedValue({ id: "u1", email: "show@x.com" });
  getShowProfileByUserId.mockReset().mockResolvedValue(completeProfile);
  completeShowProfile.mockReset().mockResolvedValue({ ...completeProfile, onboarded_at: "2026-07-16T00:00:00Z" });
  cookiesGet.mockReset().mockReturnValue(undefined);
});

describe("POST /api/show-profile/complete", () => {
  it("returns the sanitized pitch path and clears the cookie when the return cookie is present", async () => {
    cookiesGet.mockReturnValue({ value: "/outreach/tok123" });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirect_to).toBe("/outreach/tok123");
    expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe("");
  });

  it("returns redirect_to null (and still clears) when no return cookie is set", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirect_to).toBeNull();
    expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe("");
  });

  it("drops a tampered open-redirect cookie value to null but still clears it", async () => {
    cookiesGet.mockReturnValue({ value: "//evil.com/steal" });
    const res = await call();
    const body = await res.json();
    expect(body.redirect_to).toBeNull();
    expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe("");
  });

  it("401s when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("400s when there is no show profile to complete", async () => {
    getShowProfileByUserId.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(400);
  });

  it("400s when required fields are missing", async () => {
    getShowProfileByUserId.mockResolvedValue({ show_name: "Only a name" });
    const res = await call();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing).toContain("platform");
  });
});
