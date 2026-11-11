import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptString } from "@/lib/youtube-oauth/crypto";

const auth = vi.fn();
const show = vi.fn();
const enforce = vi.fn();
const listLive = vi.fn();
const disconnect = vi.fn();
const revoke = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/youtube-oauth/limits", () => ({
  enforceYoutubeDisconnect: (...args: unknown[]) => enforce(...args),
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: (...args: unknown[]) => show(...args),
  listLiveCiphertexts: (...args: unknown[]) => listLive(...args),
  disconnectYoutubeUser: (...args: unknown[]) => disconnect(...args),
}));

vi.mock("@/lib/youtube-oauth/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/youtube-oauth/google")>("@/lib/youtube-oauth/google");
  return { ...actual, revokeGoogleToken: (...args: unknown[]) => revoke(...args) };
});

import { POST } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 6);
const REFRESH = "refresh-plain-token";

function post(origin?: string): Promise<Response> {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return POST(new NextRequest("https://taylslate.com/api/youtube/disconnect", { method: "POST", headers }));
}

describe("POST /api/youtube/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: "profile-1" });
    enforce.mockResolvedValue(null);
    disconnect.mockResolvedValue("ok");
    revoke.mockResolvedValue(undefined);
    listLive.mockResolvedValue([
      {
        id: "conn-1",
        channel_id: "UCone",
        refresh_token_enc: encryptString(REFRESH, KEY),
        access_token_enc: encryptString("access-plain", KEY),
      },
    ]);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-value";
    process.env.YOUTUBE_TOKEN_ENC_KEY = KEY.toString("base64");
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
  });

  it("revokes at Google and clears the local connection", async () => {
    const res = await post("https://www.taylslate.com");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(revoke).toHaveBeenCalledWith(REFRESH);
    expect(disconnect).toHaveBeenCalledWith(USER);
    expect(JSON.stringify(body)).not.toContain(REFRESH);
  });

  it("refuses a cross-origin POST before revoke", async () => {
    const missing = await post();
    expect(missing.status).toBe(403);
    const other = await post("https://evil.example");
    expect(other.status).toBe(403);
    expect(revoke).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("revokes every live grant and nulls both rows", async () => {
    const second = "second-refresh-token";
    listLive.mockResolvedValue([
      {
        id: "conn-1",
        channel_id: "UCone",
        refresh_token_enc: encryptString(REFRESH, KEY),
        access_token_enc: null,
      },
      {
        id: "conn-2",
        channel_id: "UCtwo",
        refresh_token_enc: encryptString(second, KEY),
        access_token_enc: null,
      },
    ]);
    const res = await post("https://www.taylslate.com");
    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith(REFRESH);
    expect(revoke).toHaveBeenCalledWith(second);
    expect(disconnect).toHaveBeenCalledWith(USER);
  });
});
