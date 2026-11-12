import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNERSHIP_ERRORS, OWNERSHIP_MESSAGES } from "@/lib/ownership/check";

const auth = vi.fn();
const show = vi.fn();
const limitCheck = vi.fn();
const checkMock = vi.fn();

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
    enforceOwnershipCheck: (...args: unknown[]) => limitCheck(...args),
    checkOwnership: (...args: unknown[]) => checkMock(...args),
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
    new NextRequest("https://www.taylslate.com/api/ownership/check", {
      method: "POST",
      headers,
      body: body === undefined ? "{}" : JSON.stringify(body),
    })
  );
}

describe("POST /api/ownership/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: PROFILE });
    limitCheck.mockResolvedValue(null);
    checkMock.mockResolvedValue({ ok: true, outcome: "miss", message: OWNERSHIP_MESSAGES.miss });
  });

  it("returns 401 when there is no session", async () => {
    auth.mockResolvedValue(null);
    const res = await post("https://www.taylslate.com");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a brand and for a show with no profile", async () => {
    show.mockResolvedValue({ ok: false });
    const brand = await post("https://www.taylslate.com", { role: "brand" });
    expect(brand.status).toBe(403);
    const noProfile = await post("https://www.taylslate.com");
    expect(noProfile.status).toBe(403);
    expect(await noProfile.json()).toEqual({ error: "Forbidden" });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const missing = await post();
    expect(missing.status).toBe(403);
    const other = await post("https://evil.example");
    expect(other.status).toBe(403);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("ignores a code and a user id in the body", async () => {
    const res = await post("https://www.taylslate.com", { code: CODE, user_id: "attacker", show_id: "show-secret" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ outcome: "miss", message: OWNERSHIP_MESSAGES.miss });
    expect(JSON.stringify(body)).not.toContain(CODE);
    expect(checkMock).toHaveBeenCalledWith({ userId: USER });
  });

  it("sets Cache-Control no-store on 200, 4xx, and 503", async () => {
    const ok = await post("https://www.taylslate.com");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");

    show.mockResolvedValueOnce({ ok: false });
    const forbidden = await post("https://www.taylslate.com");
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("Cache-Control")).toBe("no-store");

    limitCheck.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await post("https://www.taylslate.com");
    expect(closed.status).toBe(503);
    expect(closed.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 429 per minute and per day, and 503 when the limiter fails closed", async () => {
    limitCheck.mockResolvedValueOnce(
      NextResponse.json({ error: OWNERSHIP_ERRORS.rate }, { status: 429, headers: { "Retry-After": "60" } })
    );
    const minute = await post("https://www.taylslate.com");
    expect(minute.status).toBe(429);
    expect(minute.headers.get("Retry-After")).toBe("60");

    limitCheck.mockResolvedValueOnce(
      NextResponse.json({ error: OWNERSHIP_ERRORS.rate }, { status: 429, headers: { "Retry-After": "86400" } })
    );
    const day = await post("https://www.taylslate.com");
    expect(day.status).toBe(429);
    expect(day.headers.get("Retry-After")).toBe("86400");

    limitCheck.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await post("https://www.taylslate.com");
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
    expect(checkMock).not.toHaveBeenCalled();
  });
});
