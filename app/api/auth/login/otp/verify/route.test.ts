import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ONBOARDING_RETURN_COOKIE } from "@/lib/auth/onboarding-return";

const { verifyOtp, signOut, from, cookieSet, verifyOutreachToken } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  cookieSet: vi.fn(),
  verifyOutreachToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp, signOut } })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from },
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock("@/lib/io/tokens", () => ({
  verifyOutreachToken: (...args: unknown[]) => verifyOutreachToken(...args),
}));

import { POST } from "./route";

let profile: { id: string; role: string } | null = { id: "show-1", role: "show" };

function req(body: unknown): NextRequest {
  return new NextRequest("https://www.taylslate.com/api/auth/login/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  verifyOtp.mockReset();
  signOut.mockReset();
  from.mockReset();
  cookieSet.mockReset();
  verifyOutreachToken.mockReset();
  profile = { id: "show-1", role: "show" };
  signOut.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({
    data: { user: { id: "show-1" } },
    error: null,
  });
  from.mockImplementation(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: profile, error: null })),
    };
    return chain;
  });
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("POST /api/auth/login/otp/verify", () => {
  it("verifies a 6-digit code and returns the next path", async () => {
    const res = await POST(
      req({ email: "Host@Example.com", code: "482913", next: "/campaigns/abc" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/campaigns/abc" });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "host@example.com",
      token: "482913",
      type: "email",
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("returns expired when the code is past its window", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_expired", message: "Token has expired or is invalid" },
    });
    const res = await POST(req({ email: "host@example.com", code: "482913" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expired" });
    expect(from).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("returns invalid_code for a wrong code", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_invalid", message: "Token has expired or is invalid" },
    });
    const res = await POST(req({ email: "host@example.com", code: "000000" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("rejects a non-digit code without calling verifyOtp", async () => {
    const res = await POST(req({ email: "host@example.com", code: "12ab56" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("signs a brand in and sends show onboarding back to the dashboard", async () => {
    profile = { id: "brand-1", role: "brand" };
    verifyOtp.mockResolvedValue({
      data: { user: { id: "brand-1" } },
      error: null,
    });
    const res = await POST(
      req({ email: "brand@example.com", code: "482913", next: "/onboarding/show" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/dashboard" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("keeps a brand's own next path", async () => {
    profile = { id: "brand-1", role: "brand" };
    verifyOtp.mockResolvedValue({
      data: { user: { id: "brand-1" } },
      error: null,
    });
    const res = await POST(
      req({ email: "brand@example.com", code: "482913", next: "/campaigns/abc" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/campaigns/abc" });
  });

  it("signs out when the verified user has no profile role", async () => {
    profile = null;
    const res = await POST(req({ email: "brand@example.com", code: "482913" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verify_failed" });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("drops an open-redirect next", async () => {
    const res = await POST(req({ email: "host@example.com", code: "482913", next: "//evil.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/dashboard" });
  });

  it("sets the onboarding return cookie for a valid outreach token", async () => {
    verifyOutreachToken.mockReturnValue({ outreach_id: "out-1", iat: 1, v: 1 });
    const res = await POST(
      req({
        email: "host@example.com",
        code: "482913",
        next: "/onboarding/show",
        outreach_token: "pitch-token",
      }),
    );
    expect(res.status).toBe(200);
    expect(cookieSet).toHaveBeenCalledWith(
      ONBOARDING_RETURN_COOKIE,
      "/outreach/pitch-token",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });
});
