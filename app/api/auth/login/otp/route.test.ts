import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  applyLoginOtpRpc,
  type LoginOtpBucket,
  type LoginOtpRpcArgs,
} from "@/lib/auth/login-otp-limit";

const { generateLink, deleteUser, createUser, sendEmail, from, rpc, verifyOutreachToken, getOutreachById, eq, ilike } =
  vi.hoisted(() => ({
    generateLink: vi.fn(),
    deleteUser: vi.fn(),
    createUser: vi.fn(),
    sendEmail: vi.fn(),
    from: vi.fn(),
    rpc: vi.fn(),
    verifyOutreachToken: vi.fn(),
    getOutreachById: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { generateLink, deleteUser, createUser } },
    from,
    rpc,
  },
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
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
let lookupError: { message: string } | null = null;

function profileChain() {
  const chain = {
    select: vi.fn(() => chain),
    ilike: vi.fn((...args: unknown[]) => {
      ilike(...args);
      return chain;
    }),
    eq: vi.fn((...args: unknown[]) => {
      eq(...args);
      return chain;
    }),
    maybeSingle: vi.fn(async () => ({ data: profile, error: lookupError })),
    insert: vi.fn(async () => ({ error: null })),
  };
  return chain;
}

function req(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest("https://www.taylslate.com/api/auth/login/otp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  generateLink.mockReset();
  deleteUser.mockReset();
  createUser.mockReset();
  sendEmail.mockReset();
  from.mockReset();
  rpc.mockReset();
  verifyOutreachToken.mockReset();
  getOutreachById.mockReset();
  eq.mockReset();
  ilike.mockReset();
  store.clear();
  profile = { id: "show-1", role: "show" };
  lookupError = null;
  from.mockImplementation(() => profileChain());
  rpc.mockImplementation(async (_name: string, args: LoginOtpRpcArgs) => ({
    data: applyLoginOtpRpc(store, args, Date.now()),
    error: null,
  }));
  generateLink.mockResolvedValue({
    data: {
      user: { id: "show-1" },
      properties: {
        hashed_token: "tok-hash",
        email_otp: "482913",
        verification_type: "magiclink",
      },
    },
    error: null,
  });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  createUser.mockResolvedValue({ data: { user: { id: "new-show" } }, error: null });
  sendEmail.mockResolvedValue({ ok: true, id: "msg_1" });
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("POST /api/auth/login/otp", () => {
  it("emails a 6-digit code for an existing show", async () => {
    const res = await POST(
      req(
        { email: "Host@Example.com" },
        {
          "x-vercel-forwarded-for": "198.51.100.20",
          "x-forwarded-for": "203.0.113.5, 10.0.0.1",
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(eq).toHaveBeenCalledWith("email", "host@example.com");
    expect(ilike).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "login_otp_consume",
      expect.objectContaining({
        p_action: "send",
        p_email: "host@example.com",
        p_ip: "198.51.100.20",
        p_clear_pending: true,
      }),
    );
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "host@example.com",
      options: {
        redirectTo: "https://www.taylslate.com/callback?next=%2Fdashboard",
        shouldCreateUser: false,
      },
    });
    expect(createUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("host@example.com");
    expect(sent.subject).toBe("Your Taylslate sign-in code");
    expect(sent.from).toBe("Taylslate <auth@taylslate.com>");
    expect(sent.bypassManagedReroute).toBe(true);
    expect(sent.html).toContain("482913");
    expect(sent.html).not.toContain("token_hash=");
    expect(sent.text).toContain("482913");
  });

  it("matches a wildcard email exactly", async () => {
    const res = await POST(req({ email: "a%@b_c.com" }));
    expect(res.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("email", "a%@b_c.com");
    expect(ilike).not.toHaveBeenCalled();
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a%@b_c.com" }),
    );
  });

  it("rejects an empty email", async () => {
    const res = await POST(req({ email: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email required" });
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("emails a 6-digit code for an existing brand", async () => {
    profile = { id: "brand-1", role: "brand" };
    const res = await POST(req({ email: "brand@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "brand@example.com", type: "magiclink" }),
    );
    expect(createUser).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("brand@example.com");
    expect(sendEmail.mock.calls[0][0].html).toContain("482913");
  });

  it("returns ok for an unknown email and does not create a user or send mail", async () => {
    profile = null;
    const res = await POST(req({ email: "nobody@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(generateLink).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "login_otp_consume",
      expect.objectContaining({
        p_email: "nobody@example.com",
        p_pending_hash: null,
        p_clear_pending: false,
      }),
    );
  });

  it("rolls back a GoTrue signup conversion and still answers ok", async () => {
    generateLink.mockResolvedValue({
      data: {
        user: { id: "created-user" },
        properties: { hashed_token: "tok", email_otp: "482913", verification_type: "signup" },
      },
      error: null,
    });
    const res = await POST(req({ email: "host@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith("created-user");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("answers ok when generateLink reports an unknown user", async () => {
    generateLink.mockResolvedValue({
      data: { user: null, properties: {} },
      error: { message: "User with this email not found", code: "user_not_found" },
    });
    const res = await POST(req({ email: "host@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("waits 60 seconds before another code can be sent", async () => {
    const first = await POST(req({ email: "host@example.com" }));
    expect(first.status).toBe(200);
    const second = await POST(req({ email: "host@example.com" }));
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error).toBe("resend_wait");
    expect(body.retry_after_sec).toBeGreaterThan(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("emails a pitch code without creating the show account yet", async () => {
    profile = null;
    verifyOutreachToken.mockReturnValue({ outreach_id: "out-1", iat: 1, v: 1 });
    getOutreachById.mockResolvedValue({
      id: "out-1",
      show_name: "Daily",
      sent_to_email: " New@Example.com ",
    });
    const res = await POST(
      req({ email: "new@example.com", outreach_token: "pitch-token" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("new@example.com");
    expect(sent.text).toMatch(/\b\d{6}\b/);
    expect(rpc).toHaveBeenCalledWith(
      "login_otp_consume",
      expect.objectContaining({
        p_action: "send",
        p_email: "new@example.com",
        p_pending_outreach: "out-1",
        p_pending_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("returns ok when the outreach contact email does not match", async () => {
    profile = null;
    verifyOutreachToken.mockReturnValue({ outreach_id: "out-1", iat: 1, v: 1 });
    getOutreachById.mockResolvedValue({
      id: "out-1",
      show_name: "Daily",
      sent_to_email: "host@example.com",
    });
    const res = await POST(
      req({ email: "other@example.com", outreach_token: "pitch-token" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "login_otp_consume",
      expect.objectContaining({ p_email: "other@example.com", p_pending_hash: null }),
    );
  });

  it("keeps an invalid outreach token as 401", async () => {
    verifyOutreachToken.mockReturnValue(null);
    const res = await POST(
      req({ email: "new@example.com", outreach_token: "bad-token" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid outreach token" });
    expect(rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps a missing outreach as 404", async () => {
    verifyOutreachToken.mockReturnValue({ outreach_id: "gone", iat: 1, v: 1 });
    getOutreachById.mockResolvedValue(null);
    const res = await POST(
      req({ email: "new@example.com", outreach_token: "pitch-token" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Outreach not found" });
    expect(rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter is unavailable", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "function login_otp_consume does not exist" },
    });
    const res = await POST(req({ email: "host@example.com" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
