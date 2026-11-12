import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNERSHIP_ERRORS, OWNERSHIP_MESSAGES } from "@/lib/ownership/check";

const auth = vi.fn();
const show = vi.fn();
const limitStart = vi.fn();
const startMock = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: (...args: unknown[]) => show(...args),
}));

vi.mock("@/lib/ownership/check", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownership/check")>("@/lib/ownership/check");
  return {
    ...actual,
    enforceOwnershipStart: (...args: unknown[]) => limitStart(...args),
    startOwnership: (...args: unknown[]) => startMock(...args),
  };
});

import { POST } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const CODE = "TAYLSLATE-AB2C34";

function post(origin?: string, body?: unknown): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return POST(
    new NextRequest("https://www.taylslate.com/api/ownership/start", {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

describe("POST /api/ownership/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: PROFILE });
    limitStart.mockResolvedValue(null);
    startMock.mockResolvedValue({
      ok: true,
      code: CODE,
      message: OWNERSHIP_MESSAGES.paste,
      target: "feeds.example.com/show",
      medium: "podcast",
    });
  });

  it("returns 401 when there is no session", async () => {
    auth.mockResolvedValue(null);
    const res = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(show).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a brand", async () => {
    show.mockResolvedValue({ ok: false });
    const res = await post("https://www.taylslate.com", { medium: "podcast", role: "brand" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a show role with no show profile", async () => {
    show.mockResolvedValue({ ok: false });
    const res = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const missing = await post(undefined, { medium: "podcast" });
    expect(missing.status).toBe(403);
    const other = await post("https://evil.example", { medium: "podcast" });
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: "Forbidden" });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("passes 400 and 409 fixed errors through", async () => {
    startMock.mockResolvedValueOnce({ ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed });
    const missingFeed = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(missingFeed.status).toBe(400);
    expect(await missingFeed.json()).toEqual({ error: OWNERSHIP_ERRORS.noFeed });

    startMock.mockResolvedValueOnce({ ok: false, status: 409, error: OWNERSHIP_ERRORS.noCatalog });
    const noShow = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(noShow.status).toBe(409);
    expect(await noShow.json()).toEqual({ error: OWNERSHIP_ERRORS.noCatalog });
  });

  it("returns the code once and ignores a user id in the body", async () => {
    const res = await post("https://www.taylslate.com", {
      medium: "podcast",
      user_id: "attacker",
      show_id: "show-secret",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: CODE,
      message: OWNERSHIP_MESSAGES.paste,
      target: "feeds.example.com/show",
      medium: "podcast",
    });
    expect(startMock).toHaveBeenCalledWith({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      channel: "",
    });
  });

  it("hides a non-fixed error", async () => {
    startMock.mockResolvedValue({ ok: false, status: 500, error: "duplicate key secret-db-text" });
    const res = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("sets Cache-Control no-store on 200, 4xx, and 503", async () => {
    const ok = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");

    startMock.mockResolvedValueOnce({ ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed });
    const missing = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(missing.status).toBe(400);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    limitStart.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(closed.status).toBe(503);
    expect(closed.headers.get("Cache-Control")).toBe("no-store");

    limitStart.mockResolvedValueOnce(
      NextResponse.json({ error: OWNERSHIP_ERRORS.rate }, { status: 429, headers: { "Retry-After": "86400" } })
    );
    const limited = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(limited.headers.get("Retry-After")).toBe("86400");
  });

  it("returns 429 and 503 from the limiter", async () => {
    limitStart.mockResolvedValueOnce(
      NextResponse.json({ error: OWNERSHIP_ERRORS.rate }, { status: 429, headers: { "Retry-After": "86400" } })
    );
    const limited = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: OWNERSHIP_ERRORS.rate });
    expect(startMock).not.toHaveBeenCalled();

    limitStart.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await post("https://www.taylslate.com", { medium: "podcast" });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
    expect(startMock).not.toHaveBeenCalled();
  });
});
