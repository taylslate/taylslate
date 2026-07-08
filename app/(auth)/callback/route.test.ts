import { describe, it, expect, vi, beforeEach } from "vitest";

// The route builds a Supabase server client and calls verifyOtp (token_hash
// branch) or exchangeCodeForSession (PKCE code branch). Both are plain spies.
const { verifyOtp, exchangeCodeForSession } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { verifyOtp, exchangeCodeForSession },
  })),
}));

import { GET, safeNextPath } from "./route";

const ORIGIN = "https://www.taylslate.com";
const call = (query: string) => GET(new Request(`${ORIGIN}/callback${query}`));
const locationOf = (res: Response) => res.headers.get("location");

beforeEach(() => {
  verifyOtp.mockReset();
  exchangeCodeForSession.mockReset();
});

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/onboarding", ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("/dashboard?x=1", ORIGIN)).toBe("/dashboard?x=1");
  });

  it("falls back to /onboarding when next is missing", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/onboarding");
  });

  it("rejects protocol-relative //evil.com (cross-origin → fallback)", () => {
    expect(safeNextPath("//evil.com", ORIGIN)).toBe("/onboarding");
    // The resolved redirect can never leave our origin.
    expect(new URL(ORIGIN + safeNextPath("//evil.com", ORIGIN)).origin).toBe(ORIGIN);
  });

  it("rejects absolute cross-origin URLs → fallback", () => {
    expect(safeNextPath("https://evil.com/steal", ORIGIN)).toBe("/onboarding");
  });

  it("rejects @evil/x — no leading slash → fallback", () => {
    // "@evil/x" has no leading slash, so it's rejected outright rather than
    // normalized to a same-origin /@evil/x. Guards against userinfo-style
    // open-redirect attempts before any URL parsing.
    expect(safeNextPath("@evil/x", ORIGIN)).toBe("/onboarding");
  });

  it("rejects a backslash-authority /\\evil.com → fallback", () => {
    expect(safeNextPath("/\\evil.com", ORIGIN)).toBe("/onboarding");
  });
});

describe("GET /callback — token_hash branch (admin-minted, e.g. signup)", () => {
  it("verifies type=signup and redirects to the validated next", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await call("?token_hash=abc123&type=signup&next=/onboarding");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
    expect(locationOf(res)).toBe(`${ORIGIN}/onboarding`);
  });

  it("verifies type=recovery (password reset) and redirects to the validated next", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await call("?token_hash=rec123&type=recovery&next=/reset-password");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "rec123" });
    expect(locationOf(res)).toBe(`${ORIGIN}/reset-password`);
  });

  it("redirects to /login when verifyOtp fails", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const res = await call("?token_hash=abc123&type=signup&next=/onboarding");
    expect(locationOf(res)).toBe(`${ORIGIN}/login`);
  });

  it("ignores an unknown otp type (never passed to verifyOtp)", async () => {
    const res = await call("?token_hash=abc123&type=bogus&next=/onboarding");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe(`${ORIGIN}/login`);
  });

  it("cannot be redirected off-origin via a malicious next", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await call("?token_hash=abc123&type=signup&next=//evil.com");
    expect(locationOf(res)).toBe(`${ORIGIN}/onboarding`);
  });
});

describe("GET /callback — code branch (PKCE, untouched regression)", () => {
  it("exchanges the code and redirects to next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await call("?code=xyz&next=/dashboard");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard`);
  });

  it("redirects to /login when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const res = await call("?code=xyz&next=/dashboard");
    expect(locationOf(res)).toBe(`${ORIGIN}/login`);
  });
});
