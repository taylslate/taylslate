import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNERSHIP_ERRORS, OWNERSHIP_MESSAGES } from "@/lib/ownership/check";

const auth = vi.fn();
const show = vi.fn();
const limit = vi.fn();
const manual = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: (...args: unknown[]) => show(...args),
}));

vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>("@/lib/security/rate-limit");
  return { ...actual, enforceRules: (...args: unknown[]) => limit(...args) };
});

vi.mock("@/lib/ownership/review", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownership/review")>("@/lib/ownership/review");
  return { ...actual, requestManualOwnership: (...args: unknown[]) => manual(...args) };
});

import { POST } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const EXPLANATION = "I host this show and can add a line to the description.";

function post(origin: string | undefined, body?: unknown, headers?: Headers): Promise<Response> {
  const requestHeaders = headers ?? new Headers({ "content-type": "application/json" });
  if (origin) requestHeaders.set("origin", origin);
  return POST(
    new NextRequest("https://www.taylslate.com/api/ownership/manual", {
      method: "POST",
      headers: requestHeaders,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

describe("POST /api/ownership/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    auth.mockResolvedValue({ id: USER });
    show.mockResolvedValue({ ok: true, showProfileId: PROFILE });
    limit.mockResolvedValue(null);
    manual.mockResolvedValue({ ok: true, message: OWNERSHIP_MESSAGES.review });
  });

  it("returns 401, 403, 429, and a closed 503", async () => {
    auth.mockResolvedValueOnce(null);
    const signedOut = await post("https://www.taylslate.com", { medium: "podcast", explanation: EXPLANATION });
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("Cache-Control")).toBe("no-store");
    expect(show).not.toHaveBeenCalled();

    show.mockResolvedValueOnce({ ok: false });
    const forbidden = await post("https://www.taylslate.com", { medium: "podcast", explanation: EXPLANATION });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });
    expect(forbidden.headers.get("Cache-Control")).toBe("no-store");

    const cross = await post("https://evil.example", { medium: "podcast", explanation: EXPLANATION });
    expect(cross.status).toBe(403);
    expect(manual).not.toHaveBeenCalled();

    limit.mockResolvedValueOnce(
      NextResponse.json({ error: OWNERSHIP_ERRORS.rate }, { status: 429, headers: { "Retry-After": "86400" } })
    );
    const limited = await post("https://www.taylslate.com", { medium: "podcast", explanation: EXPLANATION });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(manual).not.toHaveBeenCalled();

    limit.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await post("https://www.taylslate.com", { medium: "podcast", explanation: EXPLANATION });
    expect(closed.status).toBe(503);
    expect(closed.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 413 and 415", async () => {
    const plain = await post("https://www.taylslate.com", "hello", new Headers({ "content-type": "text/plain", origin: "https://www.taylslate.com" }));
    expect(plain.status).toBe(415);
    expect(plain.headers.get("Cache-Control")).toBe("no-store");

    const big = await post("https://www.taylslate.com", { medium: "podcast", explanation: "x".repeat(9000) });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "Request body is too large." });
    expect(manual).not.toHaveBeenCalled();
  });

  it("passes success, a duplicate, a miss, and an http link, and ignores a body user id", async () => {
    const ok = await post("https://www.taylslate.com", {
      medium: "podcast",
      explanation: EXPLANATION,
      user_id: "attacker",
      decided_by: "attacker",
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await ok.json()).toEqual({ ok: true, message: OWNERSHIP_MESSAGES.review });
    expect(manual).toHaveBeenCalledWith({
      userId: USER,
      showProfileId: PROFILE,
      medium: "podcast",
      explanation: EXPLANATION,
      link: undefined,
      channel: undefined,
    });

    manual.mockResolvedValueOnce({ ok: false, status: 409, error: "Your request is already with our team." });
    const duplicate = await post("https://www.taylslate.com", { medium: "podcast", explanation: EXPLANATION });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "Your request is already with our team." });

    manual.mockResolvedValueOnce({ ok: false, status: 409, error: OWNERSHIP_ERRORS.noCatalog });
    const missing = await post("https://www.taylslate.com", { medium: "podcast", explanation: EXPLANATION });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: OWNERSHIP_ERRORS.noCatalog });

    manual.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: "The link must be an https URL of at most 300 characters.",
    });
    const http = await post("https://www.taylslate.com", {
      medium: "podcast",
      explanation: EXPLANATION,
      link: "http://example.com/proof",
    });
    expect(http.status).toBe(400);
    expect(await http.json()).toEqual({ error: "The link must be an https URL of at most 300 characters." });
    expect(http.headers.get("Cache-Control")).toBe("no-store");
  });
});
