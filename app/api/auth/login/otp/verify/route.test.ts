import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ONBOARDING_RETURN_COOKIE } from "@/lib/auth/onboarding-return";
import {
  applyLoginOtpRpc,
  hashLoginOtpCode,
  type LoginOtpBucket,
  type LoginOtpRpcArgs,
} from "@/lib/auth/login-otp-limit";

const {
  verifyOtp,
  signOut,
  from,
  cookieSet,
  verifyOutreachToken,
  getOutreachById,
  generateLink,
  createUser,
  deleteUser,
  rpc,
  listUsers,
  authUsers,
} = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  cookieSet: vi.fn(),
  verifyOutreachToken: vi.fn(),
  getOutreachById: vi.fn(),
  generateLink: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  rpc: vi.fn(),
  listUsers: vi.fn(),
  authUsers: { current: [{ id: "show-1", email: "host@example.com" }] as { id: string; email: string }[] },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp, signOut } })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from,
    rpc,
    auth: { admin: { generateLink, createUser, deleteUser, listUsers } },
  },
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock("@/lib/io/tokens", () => ({
  verifyOutreachToken: (...args: unknown[]) => verifyOutreachToken(...args),
}));
vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
}));

import { POST } from "./route";

const store = new Map<string, LoginOtpBucket>();
let profile: { id: string; role: string } | null = { id: "show-1", role: "show" };
let inserted: unknown[] = [];

function req(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest("https://www.taylslate.com/api/auth/login/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  verifyOtp.mockReset();
  signOut.mockReset();
  from.mockReset();
  cookieSet.mockReset();
  verifyOutreachToken.mockReset();
  getOutreachById.mockReset();
  generateLink.mockReset();
  createUser.mockReset();
  deleteUser.mockReset();
  rpc.mockReset();
  store.clear();
  inserted = [];
  profile = { id: "show-1", role: "show" };
  authUsers.current = [{ id: "show-1", email: "host@example.com" }];
  listUsers.mockImplementation(async () => ({ data: { users: authUsers.current }, error: null }));
  signOut.mockResolvedValue({ error: null });
  verifyOtp.mockImplementation(async (args: { token_hash?: string }) => {
    if (args?.token_hash) {
      return { data: { user: { id: "new-show" } }, error: null };
    }
    return { data: { user: { id: profile?.id ?? "show-1" } }, error: null };
  });
  from.mockImplementation(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: profile, error: null })),
      insert: vi.fn(async (row: unknown) => {
        inserted.push(row);
        return { error: null };
      }),
    };
    return chain;
  });
  rpc.mockImplementation(async (name: string, args: LoginOtpRpcArgs) => {
    if (name === "rate_limit_hit") return { data: true, error: null };
    return {
      data: applyLoginOtpRpc(store, args, Date.now()),
      error: null,
    };
  });
  createUser.mockResolvedValue({ data: { user: { id: "new-show" } }, error: null });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  generateLink.mockResolvedValue({
    data: {
      user: { id: "new-show" },
      properties: { hashed_token: "tok-hash", verification_type: "magiclink" },
    },
    error: null,
  });
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("POST /api/auth/login/otp/verify", () => {
  it("verifies a 6-digit code and returns the next path", async () => {
    const res = await POST(
      req(
        { email: "Host@Example.com", code: "482913", next: "/campaigns/abc" },
        {
          "x-vercel-forwarded-for": "198.51.100.20",
          "x-forwarded-for": "203.0.113.5, 10.0.0.1",
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/campaigns/abc" });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "host@example.com",
      token: "482913",
      type: "email",
    });
    expect(rpc).toHaveBeenCalledWith(
      "login_otp_consume",
      expect.objectContaining({ p_action: "verify", p_ip: "198.51.100.20" }),
    );
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

  it("locks the email after 5 wrong codes", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_invalid", message: "Token has expired or is invalid" },
    });
    for (let i = 0; i < 5; i++) {
      const res = await POST(req({ email: "host@example.com", code: "000000" }));
      expect(res.status).toBe(400);
    }
    const locked = await POST(req({ email: "host@example.com", code: "111111" }));
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: "locked" });
    expect(verifyOtp).toHaveBeenCalledTimes(5);
    const actions = rpc.mock.calls.map(
      (call) => (call[1] as { p_action: string }).p_action,
    );
    expect(actions.filter((action) => action === "verify")).toHaveLength(6);
    expect(actions).not.toContain("wrong");
  });

  it("rejects a non-digit code without calling verifyOtp", async () => {
    const res = await POST(req({ email: "host@example.com", code: "12ab56" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("signs a brand in and sends show onboarding back to the dashboard", async () => {
    profile = { id: "brand-1", role: "brand" };
    authUsers.current = [{ id: "brand-1", email: "brand@example.com" }];
    const res = await POST(
      req({ email: "brand@example.com", code: "482913", next: "/onboarding/show" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/dashboard" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("keeps a brand's own next path", async () => {
    profile = { id: "brand-1", role: "brand" };
    authUsers.current = [{ id: "brand-1", email: "brand@example.com" }];
    const res = await POST(
      req({ email: "brand@example.com", code: "482913", next: "/campaigns/abc" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/campaigns/abc" });
  });

  it("signs out when the verified user has no profile role", async () => {
    profile = { id: "show-1", role: "" };
    const res = await POST(req({ email: "host@example.com", code: "482913" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verify_failed" });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("does not sign in the attacker when profiles.email is the victim address", async () => {
    authUsers.current = [
      { id: "victim-1", email: "victim@example.com" },
      { id: "attacker-1", email: "attacker@example.com" },
    ];
    const rows = [
      { id: "victim-1", role: "show", email: "victim@example.com" },
      { id: "attacker-1", role: "show", email: "victim@example.com" },
    ];
    from.mockImplementation(() => {
      const filters: Record<string, string> = {};
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((column: string, value: string) => {
          filters[column] = value;
          return chain;
        }),
        maybeSingle: vi.fn(async () => {
          if (filters.email) {
            return { data: rows.find((row) => row.email === filters.email) ?? null, error: null };
          }
          return { data: rows.find((row) => row.id === filters.id) ?? null, error: null };
        }),
        insert: vi.fn(async () => ({ error: null })),
      };
      return chain;
    });
    verifyOtp.mockResolvedValue({ data: { user: { id: "attacker-1" } }, error: null });
    const denied = await POST(req({ email: "victim@example.com", code: "482913" }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "verify_failed" });
    expect(signOut).toHaveBeenCalled();

    verifyOtp.mockResolvedValue({ data: { user: { id: "victim-1" } }, error: null });
    signOut.mockClear();
    const allowed = await POST(req({ email: "victim@example.com", code: "482913" }));
    expect(allowed.status).toBe(200);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not open a session when there is no profile and no pitch code", async () => {
    profile = null;
    const res = await POST(req({ email: "nobody@example.com", code: "482913" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("creates the show account when the pitch code matches", async () => {
    profile = null;
    const code = "482913";
    applyLoginOtpRpc(
      store,
      {
        p_action: "send",
        p_email: "new@example.com",
        p_ip: "seed",
        p_pending_hash: hashLoginOtpCode("new@example.com", code),
        p_pending_outreach: "out-1",
        p_pending_expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      Date.now(),
    );
    getOutreachById.mockResolvedValue({
      id: "out-1",
      sent_to_email: "new@example.com",
    });
    verifyOutreachToken.mockReturnValue({ outreach_id: "out-1", iat: 1, v: 1 });
    const res = await POST(
      req({
        email: "new@example.com",
        code,
        next: "/onboarding/show",
        outreach_token: "pitch-token",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/onboarding/show" });
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
      user_metadata: { source: "email_code" },
    });
    expect(inserted[0]).toMatchObject({
      id: "new-show",
      email: "new@example.com",
      role: "show",
    });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "tok-hash",
      type: "magiclink",
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not create a show when the outreach contact no longer matches", async () => {
    profile = null;
    const code = "482913";
    applyLoginOtpRpc(
      store,
      {
        p_action: "send",
        p_email: "new@example.com",
        p_ip: "seed",
        p_pending_hash: hashLoginOtpCode("new@example.com", code),
        p_pending_outreach: "out-1",
        p_pending_expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      Date.now(),
    );
    getOutreachById.mockResolvedValue({
      id: "out-1",
      sent_to_email: "host@example.com",
    });
    const res = await POST(req({ email: "new@example.com", code }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
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
