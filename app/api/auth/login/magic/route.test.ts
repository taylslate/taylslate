import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/utils/rate-limit";

const { generateLink, sendEmail } = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { auth: { admin: { generateLink } } },
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { POST } from "./route";

function req(body: unknown, origin = "https://www.taylslate.com"): NextRequest {
  return new NextRequest(`${origin}/api/auth/login/magic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  generateLink.mockReset();
  sendEmail.mockReset();
  _resetRateLimits();
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "tok-hash" } },
    error: null,
  });
  sendEmail.mockResolvedValue({ ok: true, id: "msg_1" });
});

describe("POST /api/auth/login/magic", () => {
  it("sends a magic link for a valid email shape", async () => {
    const res = await POST(req({ email: "jane@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "jane@example.com",
      options: {
        redirectTo: "https://www.taylslate.com/callback?next=%2Fdashboard",
      },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("jane@example.com");
    expect(sent.subject).toBe("Log in to Taylslate");
    expect(sent.from).toBe("Taylslate <auth@taylslate.com>");
    expect(sent.html).toContain("Log in");
    expect(sent.html).toContain("token_hash=tok-hash");
    expect(sent.html).toContain("type=magiclink");
  });

  it("rejects an empty email", async () => {
    const res = await POST(req({ email: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email required" });
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only email the same as empty", async () => {
    const res = await POST(req({ email: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email required" });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("returns 200 without sending when the address has no account", async () => {
    generateLink.mockResolvedValue({
      data: { properties: {} },
      error: { message: "User not found" },
    });
    const res = await POST(req({ email: "nobody@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("threads a safe next path into the callback URL", async () => {
    await POST(req({ email: "jane@example.com", next: "/campaigns/abc" }));
    expect(generateLink.mock.calls[0][0].options.redirectTo).toBe(
      "https://www.taylslate.com/callback?next=%2Fcampaigns%2Fabc",
    );
    expect(sendEmail.mock.calls[0][0].html).toContain("next=%2Fcampaigns%2Fabc");
  });

  it("drops an open-redirect next and falls back to /dashboard", async () => {
    await POST(req({ email: "jane@example.com", next: "//evil.com" }));
    expect(generateLink.mock.calls[0][0].options.redirectTo).toBe(
      "https://www.taylslate.com/callback?next=%2Fdashboard",
    );
  });
});
