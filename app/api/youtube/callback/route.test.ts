import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sealJson, sha256Hex } from "@/lib/youtube-oauth/crypto";

const auth = vi.fn();
const show = vi.fn();
const enforce = vi.fn();
const tables = vi.fn();
const exchange = vi.fn();
const listChannel = vi.fn();
const revoke = vi.fn();
const upsert = vi.fn();
const logEvent = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

vi.mock("@/lib/youtube-oauth/limits", () => ({
  enforceYoutubeCallback: (...args: unknown[]) => enforce(...args),
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: (...args: unknown[]) => show(...args),
  youtubeOauthTablesReady: () => tables(),
  upsertConnection: (...args: unknown[]) => upsert(...args),
}));

vi.mock("@/lib/youtube-oauth/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/youtube-oauth/google")>("@/lib/youtube-oauth/google");
  return {
    ...actual,
    exchangeAuthorizationCode: (...args: unknown[]) => exchange(...args),
    listOwnedChannel: (...args: unknown[]) => listChannel(...args),
    revokeGoogleToken: (...args: unknown[]) => revoke(...args),
  };
});

import { GET } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = Buffer.alloc(32, 5);
const STATE = "state-value";
const VERIFIER = "verifier-value";
const REFRESH = "refresh-plain-token";
const ACCESS = "access-plain-token";

function cookieFor(userId: string, issuedAt = Date.now()): string {
  return sealJson(
    { state_hash: sha256Hex(STATE), verifier: VERIFIER, user_id: userId, issued_at: issuedAt },
    KEY
  );
}

function callback(cookie: string | null, query = `code=auth-code&state=${STATE}`): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `yt_oauth=${cookie}`);
  return GET(new NextRequest(`https://evil.example/api/youtube/callback?${query}`, { headers }));
}

describe("GET /api/youtube/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: "profile-1" });
    enforce.mockResolvedValue(null);
    tables.mockResolvedValue(true);
    exchange.mockResolvedValue({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresIn: 3600,
      scope:
        "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly",
    });
    listChannel.mockResolvedValue({ ok: true, channel: { channelId: "UCchannel", title: "The Show" } });
    revoke.mockResolvedValue(undefined);
    upsert.mockResolvedValue({ ok: true, id: "conn-1" });
    logEvent.mockResolvedValue(null);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-value";
    process.env.YOUTUBE_TOKEN_ENC_KEY = KEY.toString("base64");
    process.env.NEXT_PUBLIC_SITE_URL = "https://taylslate.com";
  });

  it("does not exchange the code when state, the cookie, or the user does not match", async () => {
    const mismatch = await callback(cookieFor(USER), "code=auth-code&state=other");
    expect(new URL(mismatch.headers.get("location") ?? "").searchParams.get("error")).toBe("state");
    const missing = await callback(null);
    expect(new URL(missing.headers.get("location") ?? "").searchParams.get("error")).toBe("state");
    const expired = await callback(cookieFor(USER, Date.now() - 11 * 60 * 1000));
    expect(new URL(expired.headers.get("location") ?? "").searchParams.get("error")).toBe("expired");
    const otherUser = await callback(cookieFor(OTHER));
    expect(new URL(otherUser.headers.get("location") ?? "").searchParams.get("error")).toBe("user");
    const first = await callback(cookieFor(USER), "code=auth-code&state=other");
    expect(first.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
    const replay = await callback(null);
    expect(new URL(replay.headers.get("location") ?? "").searchParams.get("error")).toBe("state");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("stores encrypted tokens and redirects only to the settings page", async () => {
    const res = await callback(cookieFor(USER), `code=auth-code&state=${STATE}&next=https://evil.example/phish`);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://taylslate.com");
    expect(location.pathname).toBe("/settings/youtube");
    expect(location.searchParams.get("connected")).toBe("1");
    expect(location.searchParams.has("next")).toBe(false);
    expect(upsert).toHaveBeenCalledOnce();
    const saved = upsert.mock.calls[0][0] as { refreshTokenEnc: string; accessTokenEnc: string; scopes: string[] };
    expect(saved.refreshTokenEnc).not.toContain(REFRESH);
    expect(saved.accessTokenEnc).not.toContain(ACCESS);
    expect(saved.refreshTokenEnc.startsWith("v1.")).toBe(true);
    expect(saved.scopes).toHaveLength(2);
    expect(JSON.stringify(logEvent.mock.calls[0][0])).not.toContain(REFRESH);
    expect(JSON.stringify(logEvent.mock.calls[0][0])).toContain("youtube.channel_connected");
  });

  it("revokes when Google returns two channels or the channel is already connected", async () => {
    listChannel.mockResolvedValueOnce({ ok: false, reason: "channel" });
    const two = await callback(cookieFor(USER));
    expect(new URL(two.headers.get("location") ?? "").searchParams.get("error")).toBe("channel");
    expect(revoke).toHaveBeenCalledWith(REFRESH);
    upsert.mockResolvedValueOnce({ ok: false, reason: "channel_taken" });
    listChannel.mockResolvedValueOnce({ ok: true, channel: { channelId: "UCchannel", title: "The Show" } });
    const taken = await callback(cookieFor(USER));
    expect(new URL(taken.headers.get("location") ?? "").searchParams.get("error")).toBe("channel_taken");
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
