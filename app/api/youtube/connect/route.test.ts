import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const show = vi.fn();
const enforce = vi.fn();
const tables = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/youtube-oauth/limits", () => ({
  enforceYoutubeConnect: (...args: unknown[]) => enforce(...args),
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: (...args: unknown[]) => show(...args),
  youtubeOauthTablesReady: () => tables(),
}));

import { GET } from "./route";
import { decryptString, sha256Hex } from "@/lib/youtube-oauth/crypto";

const USER = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 4);

function call(): Promise<Response> {
  return GET(new NextRequest("https://taylslate.com/api/youtube/connect"));
}

describe("GET /api/youtube/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: "profile-1" });
    enforce.mockResolvedValue(null);
    tables.mockResolvedValue(true);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-value";
    process.env.YOUTUBE_TOKEN_ENC_KEY = KEY.toString("base64");
    process.env.NEXT_PUBLIC_SITE_URL = "https://taylslate.com";
  });

  it("returns 401 when signed out", async () => {
    auth.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("returns 403 for a brand", async () => {
    show.mockResolvedValue({ ok: false });
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("returns 503 when oauth is not configured", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const res = await call();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "unavailable" });
    expect(enforce).not.toHaveBeenCalled();
  });

  it("sets an httpOnly secure cookie and does not put the secret in the redirect", async () => {
    const res = await call();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    const url = new URL(location);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.taylslate.com/api/youtube/callback");
    expect(url.searchParams.get("scope")?.split(" ")).toHaveLength(2);
    expect(location).not.toContain("client-secret-value");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/api/youtube");
    expect(cookie).toContain("Max-Age=600");
    const value = cookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    const payload = decryptString(decodeURIComponent(value), KEY);
    const parsed = JSON.parse(payload) as { state_hash: string; verifier: string; user_id: string };
    expect(parsed.user_id).toBe(USER);
    expect(parsed.state_hash).toBe(sha256Hex(url.searchParams.get("state") ?? ""));
    expect(parsed.verifier.length).toBeGreaterThan(10);
  });

  it("returns 429 and a fail-closed 503 from the rate limiter", async () => {
    enforce.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Too many requests. Try again later." }), { status: 429 }));
    const limited = await call();
    expect(limited.status).toBe(429);
    enforce.mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));
    const closed = await call();
    expect(closed.status).toBe(503);
    await expect(closed.json()).resolves.toEqual({ error: "unavailable" });
  });
});
