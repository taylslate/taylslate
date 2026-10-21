import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/utils/rate-limit";

const { generateLink, deleteUser, createUser, sendEmail, from, verifyOutreachToken, getOutreachById } =
  vi.hoisted(() => ({
    generateLink: vi.fn(),
    deleteUser: vi.fn(),
    createUser: vi.fn(),
    sendEmail: vi.fn(),
    from: vi.fn(),
    verifyOutreachToken: vi.fn(),
    getOutreachById: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { generateLink, deleteUser, createUser } },
    from,
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

let profile: { id: string; role: string } | null = { id: "show-1", role: "show" };
let lookupError: { message: string } | null = null;
let insertError: { message: string } | null = null;

function profileChain() {
  const chain = {
    select: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: profile, error: lookupError })),
    insert: vi.fn(async () => ({ error: insertError })),
  };
  return chain;
}

function req(body: unknown): NextRequest {
  return new NextRequest("https://www.taylslate.com/api/auth/login/otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  generateLink.mockReset();
  deleteUser.mockReset();
  createUser.mockReset();
  sendEmail.mockReset();
  from.mockReset();
  verifyOutreachToken.mockReset();
  getOutreachById.mockReset();
  _resetRateLimits();
  profile = { id: "show-1", role: "show" };
  lookupError = null;
  insertError = null;
  from.mockImplementation(() => profileChain());
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
    const res = await POST(req({ email: "Host@Example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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

  it("rejects an empty email", async () => {
    const res = await POST(req({ email: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email required" });
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
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

  it("returns no_account for an unknown email and does not create a user", async () => {
    profile = null;
    const res = await POST(req({ email: "nobody@example.com" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_account" });
    expect(generateLink).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rolls back a GoTrue signup conversion instead of emailing a code", async () => {
    generateLink.mockResolvedValue({
      data: {
        user: { id: "created-user" },
        properties: { hashed_token: "tok", email_otp: "482913", verification_type: "signup" },
      },
      error: null,
    });
    const res = await POST(req({ email: "host@example.com" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_account" });
    expect(deleteUser).toHaveBeenCalledWith("created-user");
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

  it("creates a show when the email matches the outreach contact", async () => {
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
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
      user_metadata: { source: "email_code" },
    });
    const insert = from.mock.results
      .map((call) => call.value.insert)
      .find((fn) => fn.mock.calls.length > 0);
    expect(insert).toBeTruthy();
    expect(insert.mock.calls[0][0]).toMatchObject({
      id: "new-show",
      email: "new@example.com",
      role: "show",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns no_account when the outreach contact email does not match", async () => {
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
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_account" });
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
