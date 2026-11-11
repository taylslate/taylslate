import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const CREATOR_KEYS = [
  "channelId",
  "title",
  "thumbnailUrl",
  "country",
  "subscriberCount",
  "videoCount",
  "averageViews",
  "averageViewsLabel",
  "nicheTags",
  "youtubeUrl",
];

const CHANNEL = "UCabcdefghijklmnopqrstuv";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  enforceRules: vi.fn(),
  searchLibraryCreators: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
  getEffectiveRole: (...args: unknown[]) => mocks.getEffectiveRole(...args),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRules: (...args: unknown[]) => mocks.enforceRules(...args),
}));

vi.mock("@/lib/youtube-library/brand-read", () => ({
  searchLibraryCreators: (...args: unknown[]) => mocks.searchLibraryCreators(...args),
}));

import { GET } from "./route";

function call(search: string) {
  const url = new URL("https://www.taylslate.com/api/library/creators");
  if (search) url.searchParams.set("search", search);
  return GET(new NextRequest(url));
}

const creator = {
  channelId: CHANNEL,
  title: "Sauna Lab",
  thumbnailUrl: "https://i.ytimg.com/vi/lab/hqdefault.jpg",
  country: "US",
  subscriberCount: 12000,
  videoCount: 40,
  averageViews: 22000,
  averageViewsLabel: "recent" as const,
  nicheTags: ["Health"],
  youtubeUrl: `https://www.youtube.com/channel/${CHANNEL}`,
  contact_address: "hidden@creator.test",
  brand_flag: "seller",
  show_id: "show-1",
  source: "category",
  source_query: "sauna",
  keywords: ["secret"],
  description: "This stays off the search response.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: "brand" });
  mocks.enforceRules.mockResolvedValue(null);
  mocks.searchLibraryCreators.mockResolvedValue([creator]);
});

describe("GET /api/library/creators", () => {
  it("returns 401 without a session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const res = await call("Sauna");
    expect(res.status).toBe(401);
    expect(mocks.getEffectiveRole).not.toHaveBeenCalled();
    expect(mocks.enforceRules).not.toHaveBeenCalled();
    expect(mocks.searchLibraryCreators).not.toHaveBeenCalled();
  });

  it.each(["show", "agent"])("returns 403 for a %s role", async (role) => {
    mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: role });
    const res = await call("Sauna");
    expect(res.status).toBe(403);
    expect(mocks.enforceRules).not.toHaveBeenCalled();
    expect(mocks.searchLibraryCreators).not.toHaveBeenCalled();
  });

  it("returns 400 when the query is over 100 characters", async () => {
    const res = await call("a".repeat(101));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Search is too long." });
    expect(mocks.searchLibraryCreators).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit denies the call", async () => {
    mocks.enforceRules.mockResolvedValue(
      NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    );
    const res = await call("Sauna");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(mocks.searchLibraryCreators).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the rate limit check fails", async () => {
    mocks.enforceRules.mockResolvedValue(
      NextResponse.json({ error: "unavailable" }, { status: 503 })
    );
    const res = await call("Sauna");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(mocks.searchLibraryCreators).not.toHaveBeenCalled();
  });

  it("returns the public creator keys and a no-store header", async () => {
    const res = await call("Sauna");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(Object.keys(body[0])).toEqual(CREATOR_KEYS);
    expect(body[0]).toEqual({
      channelId: CHANNEL,
      title: "Sauna Lab",
      thumbnailUrl: "https://i.ytimg.com/vi/lab/hqdefault.jpg",
      country: "US",
      subscriberCount: 12000,
      videoCount: 40,
      averageViews: 22000,
      averageViewsLabel: "recent",
      nicheTags: ["Health"],
      youtubeUrl: `https://www.youtube.com/channel/${CHANNEL}`,
    });
    expect(JSON.stringify(body)).not.toContain("hidden@creator.test");
    expect(JSON.stringify(body)).not.toContain("description");
    expect(mocks.enforceRules).toHaveBeenCalledWith({
      failureMode: "closed",
      rules: [
        {
          bucket: "library_creators_user_minute",
          key: "user-1",
          max: 30,
          windowSeconds: 60,
        },
        {
          bucket: "library_creators_user_day",
          key: "user-1",
          max: 1000,
          windowSeconds: 24 * 60 * 60,
        },
      ],
    });
    expect(mocks.searchLibraryCreators).toHaveBeenCalledWith({ query: "Sauna" });
  });
});
