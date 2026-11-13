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
let upsertOptions: unknown[] = [];
let updates: unknown[] = [];
let raceWinner: { id: string; role: string } | null = null;

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
  upsertOptions = [];
  updates = [];
  raceWinner = null;
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
      upsert: vi.fn(async (row: { id: string; role: string }, opts?: unknown) => {
        inserted.push(row);
        upsertOptions.push(opts);
        if (raceWinner) profile = { ...raceWinner };
        else if (!profile) profile = { id: row.id, role: row.role };
        return { error: null };
      }),
      update: vi.fn((row: unknown) => {
        updates.push(row);
        return chain;
      }),
    };
    return chain;
  });
  rpc.mockImplementation(async (name: string, args: LoginOtpRpcArgs & { lookup?: string }) => {
    if (name === "rate_limit_hit") return { data: true, error: null };
    if (name === "auth_user_ids_for_email") {
      const lookup = String(args.lookup ?? "").toLowerCase();
      return {
        data: authUsers.current
          .filter((user) => user.email.toLowerCase() === lookup)
          .map((user) => user.id),
        error: null,
      };
    }
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

describe("POST /api/auth/login/otp/verify show sign-up", () => {
  const CODE = "482913";

  function seedSignupPending(
    email: string,
    options: { expiresInMs?: number; code?: string } = {},
  ) {
    applyLoginOtpRpc(
      store,
      {
        p_action: "send",
        p_email: email,
        p_ip: "seed",
        p_pending_hash: hashLoginOtpCode(email, options.code ?? CODE),
        p_pending_outreach: "show_signup",
        p_pending_expires: new Date(
          Date.now() + (options.expiresInMs ?? 60 * 60 * 1000),
        ).toISOString(),
      },
      Date.now(),
    );
  }

  it("creates the show account from a sign-up code and defaults next to show onboarding", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com");
    const res = await POST(req({ email: "new@example.com", code: CODE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/onboarding/show" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getOutreachById).not.toHaveBeenCalled();
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
      user_metadata: { source: "show_signup" },
    });
    expect(inserted[0]).toEqual({
      id: "new-show",
      email: "new@example.com",
      full_name: "",
      role: "show",
      tier: "free",
    });
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: expect.stringContaining("/callback?next=%2Fonboarding%2Fshow"),
        }),
      }),
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "tok-hash",
      type: "magiclink",
    });
  });

  it("keeps an explicit next and still routes it through safeLoginNext", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com");
    const res = await POST(
      req({ email: "new@example.com", code: CODE, next: "//evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/dashboard" });
  });

  it("ignores role and tier fields in the body", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com");
    const res = await POST(
      req({
        email: "new@example.com",
        code: CODE,
        role: "admin",
        tier: "operator",
      }),
    );
    expect(res.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ user_metadata: { source: "show_signup" } }),
    );
    expect(inserted[0]).toMatchObject({ role: "show", tier: "free" });
  });

  it("rejects a wrong sign-up code with invalid_code", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com");
    const res = await POST(req({ email: "new@example.com", code: "000000" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects an expired sign-up code with expired", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com", { expiresInMs: -1000 });
    const res = await POST(req({ email: "new@example.com", code: CODE }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expired" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("locks the sign-up email after 5 wrong codes", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com");
    for (let i = 0; i < 5; i++) {
      const res = await POST(req({ email: "new@example.com", code: "000000" }));
      expect(res.status).toBe(400);
    }
    const locked = await POST(req({ email: "new@example.com", code: CODE }));
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: "locked" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("is rate limited by the verify bucket and fails closed", async () => {
    profile = null;
    authUsers.current = [];
    seedSignupPending("new@example.com");
    const baseRpc = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === "rate_limit_hit") return { data: false, error: null };
      return baseRpc(name, args);
    });
    const limited = await POST(req({ email: "new@example.com", code: CODE }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(createUser).not.toHaveBeenCalled();

    rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === "rate_limit_hit") {
        return { data: null, error: { message: "secret-db-text" } };
      }
      return baseRpc(name, args);
    });
    const closed = await POST(req({ email: "new@example.com", code: CODE }));
    expect(closed.status).toBe(503);
    expect(JSON.stringify(await closed.json())).not.toContain("secret-db-text");
  });

  it("never returns DB text from any failing dependency", async () => {
    profile = null;
    authUsers.current = [];

    seedSignupPending("a@example.com");
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "secret-db-text" },
    });
    const createFail = await POST(req({ email: "a@example.com", code: CODE }));
    expect(createFail.status).toBe(500);
    expect(JSON.stringify(await createFail.json())).not.toContain("secret-db-text");
    createUser.mockResolvedValue({ data: { user: { id: "new-show" } }, error: null });

    seedSignupPending("b@example.com");
    from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn(async () => ({ error: { message: "secret-db-text" } })),
    }));
    const insertFail = await POST(req({ email: "b@example.com", code: CODE }));
    expect(insertFail.status).toBe(500);
    expect(JSON.stringify(await insertFail.json())).not.toContain("secret-db-text");
    let row: { id: string; role: string } | null = null;
    from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
      upsert: vi.fn(async (written: { id: string; role: string }) => {
        row = { id: written.id, role: written.role };
        return { error: null };
      }),
    }));

    seedSignupPending("c@example.com");
    generateLink.mockResolvedValue({
      data: { user: null, properties: {} },
      error: { message: "secret-db-text" },
    });
    const linkFail = await POST(req({ email: "c@example.com", code: CODE }));
    expect(linkFail.status).toBe(500);
    expect(JSON.stringify(await linkFail.json())).not.toContain("secret-db-text");
  });

  it("sets Cache-Control no-store on existing-user verifies too", async () => {
    const ok = await POST(req({ email: "host@example.com", code: CODE }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");

    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_invalid", message: "Token has expired or is invalid" },
    });
    const bad = await POST(req({ email: "host@example.com", code: "000000" }));
    expect(bad.status).toBe(400);
    expect(bad.headers.get("Cache-Control")).toBe("no-store");
  });

  it("creates a show profile for an auth user with no profile when the marker is valid", async () => {
    profile = null;
    seedSignupPending("host@example.com");
    const res = await POST(req({ email: "host@example.com", code: CODE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/onboarding/show" });
    expect(createUser).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(inserted[0]).toEqual({
      id: "show-1",
      email: "host@example.com",
      full_name: "",
      role: "show",
      tier: "free",
    });
    expect(upsertOptions[0]).toEqual({ onConflict: "id", ignoreDuplicates: true });
  });

  it("honors an explicit safe next for that new show profile", async () => {
    profile = null;
    seedSignupPending("host@example.com");
    const res = await POST(
      req({ email: "host@example.com", code: CODE, next: "/settings/ownership" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/settings/ownership" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("drops an unsafe next for that new show profile", async () => {
    profile = null;
    seedSignupPending("host@example.com");
    const res = await POST(
      req({ email: "host@example.com", code: CODE, next: "//evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/dashboard" });
  });

  it("leaves an existing profile untouched when the show-signup marker is set", async () => {
    for (const role of ["brand", "agent", "show"] as const) {
      profile = { id: `${role}-1`, role };
      authUsers.current = [{ id: `${role}-1`, email: `${role}@example.com` }];
      seedSignupPending(`${role}@example.com`);
      inserted = [];
      updates = [];
      const res = await POST(
        req({
          email: `${role}@example.com`,
          code: CODE,
          next: "/onboarding/show",
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.next).toBe(role === "brand" ? "/dashboard" : "/onboarding/show");
      expect(inserted).toEqual([]);
      expect(updates).toEqual([]);
      expect(createUser).not.toHaveBeenCalled();
    }
  });

  it("still 403s when an auth user has no profile and no valid marker", async () => {
    profile = null;
    const res = await POST(req({ email: "host@example.com", code: CODE }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verify_failed" });
    expect(signOut).toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("still 403s when the show-signup marker is expired", async () => {
    profile = null;
    seedSignupPending("host@example.com", { expiresInMs: -1000 });
    const res = await POST(req({ email: "host@example.com", code: CODE }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verify_failed" });
    expect(signOut).toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("still 403s when the stored profile has no role, marker or not", async () => {
    profile = { id: "show-1", role: "" };
    seedSignupPending("host@example.com");
    const res = await POST(req({ email: "host@example.com", code: CODE }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verify_failed" });
    expect(signOut).toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("keeps the role that wins the insert race and does not update the row", async () => {
    profile = null;
    raceWinner = { id: "show-1", role: "brand" };
    seedSignupPending("host@example.com");
    const res = await POST(
      req({ email: "host@example.com", code: CODE, next: "/campaigns/abc" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/campaigns/abc" });
    expect(createUser).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(inserted[0]).toMatchObject({
      id: "show-1",
      email: "host@example.com",
      role: "show",
      tier: "free",
    });
    expect(upsertOptions[0]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect(profile).toEqual({ id: "show-1", role: "brand" });
  });
});
