import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const show = vi.fn();
const enforce = vi.fn();
const readStatus = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/youtube-oauth/limits", () => ({
  enforceYoutubeStatus: (...args: unknown[]) => enforce(...args),
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: (...args: unknown[]) => show(...args),
  readYoutubeStatus: (...args: unknown[]) => readStatus(...args),
}));

import { GET } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";

describe("GET /api/youtube/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: "profile-1" });
    enforce.mockResolvedValue(null);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-value";
    process.env.YOUTUBE_TOKEN_ENC_KEY = Buffer.alloc(32, 2).toString("base64");
    process.env.NEXT_PUBLIC_SITE_URL = "https://taylslate.com";
    readStatus.mockResolvedValue({
      connected: true,
      channel_id: "UCchannel",
      channel_title: "The Show",
      status: "active",
      analytics_enabled: true,
      refresh_token_enc: "should-not-leak",
      access_token_enc: "should-not-leak",
    });
  });

  it("returns only the caller's public fields", async () => {
    const res = await GET(new NextRequest("https://taylslate.com/api/youtube/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      connected: true,
      channel_id: "UCchannel",
      channel_title: "The Show",
      status: "active",
      analytics_enabled: true,
    });
    expect(JSON.stringify(body)).not.toMatch(/token|should-not-leak/i);
    expect(readStatus).toHaveBeenCalledWith(USER);
  });

  it("returns 401 when signed out", async () => {
    auth.mockResolvedValue(null);
    const res = await GET(new NextRequest("https://taylslate.com/api/youtube/status"));
    expect(res.status).toBe(401);
    expect(readStatus).not.toHaveBeenCalled();
  });
});
