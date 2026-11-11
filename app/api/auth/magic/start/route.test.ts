import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EMAIL_FROM_AUTH } from "@/lib/email/addresses";
import { ONBOARDING_RETURN_COOKIE } from "@/lib/auth/onboarding-return";
import {
  LOGIN_CODE_SEND_EMAIL_WINDOW_SEC,
  LOGIN_CODE_SEND_IP_WINDOW_SEC,
} from "@/lib/security/rate-limit";

const { signMagicLinkToken, getOutreachById, sendEmail, from, rpc, createUser, generateLink } =
  vi.hoisted(() => ({
    signMagicLinkToken: vi.fn(),
    getOutreachById: vi.fn(),
    sendEmail: vi.fn(),
    from: vi.fn(),
    rpc: vi.fn(),
    createUser: vi.fn(),
    generateLink: vi.fn(),
  }));

vi.mock("@/lib/io/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/io/tokens")>("@/lib/io/tokens");
  signMagicLinkToken.mockImplementation((...args: unknown[]) =>
    actual.signMagicLinkToken(...(args as Parameters<typeof actual.signMagicLinkToken>)),
  );
  return {
    ...actual,
    signMagicLinkToken: (...args: unknown[]) => signMagicLinkToken(...args),
  };
});

vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc,
    from,
    auth: { admin: { createUser, generateLink } },
  },
}));

import { POST } from "./route";
import { GET } from "../route";
import { signOutreachToken, verifyMagicLinkToken } from "@/lib/io/tokens";

interface Hit {
  bucket: string;
  key: string;
  at: number;
}

interface HitArgs {
  p_bucket: string;
  p_key: string;
  p_max: number;
  p_window_seconds: number;
}

const rows = new Map<string, { sent_to_email: string }>();
let hits: Hit[] = [];
let nowMs = Date.UTC(2026, 0, 1);
let rateLimitError: { message: string } | null = null;
const authIds = ["show-1"];

function allowHit(args: HitArgs): boolean {
  const windowMs = args.p_window_seconds * 1000;
  const recent = hits.filter(
    (hit) => hit.bucket === args.p_bucket && hit.key === args.p_key && nowMs - hit.at < windowMs,
  );
  if (recent.length >= args.p_max) return false;
  hits.push({ bucket: args.p_bucket, key: args.p_key, at: nowMs });
  return true;
}

function post(body: unknown, ip = "203.0.113.5"): Promise<Response> {
  return POST(
    new NextRequest("https://www.taylslate.com/api/auth/magic/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  rows.clear();
  hits = [];
  nowMs = Date.UTC(2026, 0, 1);
  rateLimitError = null;
  signMagicLinkToken.mockClear();
  getOutreachById.mockReset();
  sendEmail.mockReset();
  from.mockReset();
  rpc.mockReset();
  createUser.mockReset();
  generateLink.mockReset();
  process.env.OUTREACH_TOKEN_SECRET = "test_outreach_secret_at_least_16_chars";
  process.env.MAGIC_LINK_TOKEN_SECRET = "test_magic_secret_at_least_16_chars__";
  delete process.env.NEXT_PUBLIC_SITE_URL;

  getOutreachById.mockImplementation(async (id: string) => {
    const row = rows.get(id);
    if (!row) return null;
    return {
      id,
      brand_profile_id: "bp-1",
      campaign_id: "camp-1",
      show_name: "Night Desk",
      sent_to_email: row.sent_to_email,
    };
  });
  sendEmail.mockResolvedValue({ ok: true, id: "msg_1" });
  createUser.mockResolvedValue({ data: { user: { id: "show-1" } }, error: null });
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "tok-hash" }, user: { id: "show-1" } },
    error: null,
  });
  from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => {
        if (table === "brand_profiles") {
          return {
            data: { brand_name: "Northwind", brand_identity: "", brand_website: "" },
            error: null,
          };
        }
        return { data: null, error: { message: "not found" } };
      },
      insert: async () => ({ error: null }),
    };
    return chain;
  });
  rpc.mockImplementation(async (name: string, args: HitArgs & { lookup?: string }) => {
    if (name === "rate_limit_hit") {
      if (rateLimitError) return { data: null, error: rateLimitError };
      return { data: allowHit(args), error: null };
    }
    if (name === "auth_user_ids_for_email") {
      return { data: authIds, error: null };
    }
    return { data: null, error: { message: "unexpected rpc" } };
  });
});

function tokenFor(id: string): string {
  return signOutreachToken(id);
}

describe("POST /api/auth/magic/start", () => {
  it("answers ok without sending when the address is not the recipient", async () => {
    rows.set("out-1", { sent_to_email: "show@example.com" });
    const outreachToken = tokenFor("out-1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mismatch = await post({
      outreach_token: outreachToken,
      email: "other@example.com",
    });
    const mismatchBody = await mismatch.text();
    expect(mismatch.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(signMagicLinkToken).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("[magic.start] recipient mismatch");
    expect(logged).toContain("out-1");
    expect(logged).not.toContain("other@example.com");
    expect(logged).not.toContain("show@example.com");
    warn.mockRestore();

    const match = await post({
      outreach_token: outreachToken,
      email: "show@example.com",
    });
    const matchBody = await match.text();
    expect(match.status).toBe(200);
    expect(mismatchBody).toBe(matchBody);
    expect(JSON.parse(matchBody)).toEqual({ ok: true });
    expect(matchBody).not.toContain("email_sent");
  });

  it("treats case and whitespace on the recipient as a match", async () => {
    rows.set("out-1", { sent_to_email: " Show@Example.com " });
    const outreachToken = tokenFor("out-1");
    const res = await post({
      outreach_token: outreachToken,
      email: "  Show@Example.com ",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0] as {
      to: string;
      html: string;
      from: string;
      bypassManagedReroute?: boolean;
    };
    expect(sent.to).toBe("show@example.com");
    expect(sent.from).toBe(EMAIL_FROM_AUTH);
    expect(sent.bypassManagedReroute).toBe(true);
    expect(sent.html).toContain("/api/auth/magic?token=");
    const encoded = sent.html.match(/\/api\/auth\/magic\?token=([^"&\s<]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const payload = verifyMagicLinkToken(decodeURIComponent(encoded!));
    expect(payload?.email).toBe("show@example.com");
    const remaining = payload!.exp - Math.floor(Date.now() / 1000);
    expect(remaining).toBeLessThanOrEqual(60 * 60);
    expect(remaining).toBeGreaterThanOrEqual(60 * 60 - 5);
    expect(new URL(payload!.return_url).pathname).toBe(`/outreach/${outreachToken}`);
    expect(payload!.return_url).toBe(
      `https://www.taylslate.com/outreach/${outreachToken}`,
    );
  });

  it("treats an empty recipient as a mismatch", async () => {
    rows.set("out-1", { sent_to_email: "" });
    const outreachToken = tokenFor("out-1");
    const blank = await post({ outreach_token: outreachToken, email: "show@example.com" });
    expect(blank.status).toBe(200);
    expect(await blank.json()).toEqual({ ok: true });
    rows.set("out-1", { sent_to_email: "   " });
    const spaces = await post({ outreach_token: outreachToken, email: "show@example.com" });
    expect(spaces.status).toBe(200);
    expect(await spaces.json()).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(signMagicLinkToken).not.toHaveBeenCalled();
  });

  it("returns 429 on the 6th call for one outreach and sends nothing", async () => {
    rows.set("out-1", { sent_to_email: "show@example.com" });
    const outreachToken = tokenFor("out-1");
    for (let i = 0; i < 5; i++) {
      const res = await post(
        { outreach_token: outreachToken, email: `other${i}@example.com` },
        "203.0.113.10",
      );
      expect(res.status).toBe(200);
    }
    const blocked = await post(
      { outreach_token: outreachToken, email: "show@example.com" },
      "203.0.113.10",
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_IP_WINDOW_SEC));
    expect(await blocked.json()).toEqual({ error: "Too many requests. Try again later." });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(signMagicLinkToken).not.toHaveBeenCalled();
  });

  it("returns 429 on the 4th call for one email in 15 minutes", async () => {
    rows.set("out-1", { sent_to_email: "show@example.com" });
    const outreachToken = tokenFor("out-1");
    for (let i = 0; i < 3; i++) {
      const res = await post(
        { outreach_token: outreachToken, email: "show@example.com" },
        "203.0.113.30",
      );
      expect(res.status).toBe(200);
    }
    expect(sendEmail).toHaveBeenCalledTimes(3);
    const blocked = await post(
      { outreach_token: outreachToken, email: "show@example.com" },
      "203.0.113.30",
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_EMAIL_WINDOW_SEC));
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it("returns 429 on the 11th call from one IP", async () => {
    for (let i = 0; i < 10; i++) {
      const id = `out-ip-${i}`;
      rows.set(id, { sent_to_email: "show@example.com" });
      const res = await post(
        { outreach_token: tokenFor(id), email: `other${i}@example.com` },
        "203.0.113.20",
      );
      expect(res.status).toBe(200);
    }
    rows.set("out-final", { sent_to_email: "show@example.com" });
    const blocked = await post(
      { outreach_token: tokenFor("out-final"), email: "show@example.com" },
      "203.0.113.20",
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_IP_WINDOW_SEC));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 503 and sends nothing when rate_limit_hit errors", async () => {
    rows.set("out-1", { sent_to_email: "show@example.com" });
    rateLimitError = { message: "database unavailable" };
    const res = await post({
      outreach_token: tokenFor("out-1"),
      email: "show@example.com",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(signMagicLinkToken).not.toHaveBeenCalled();
  });

  it("keeps a bad token as 401", async () => {
    const res = await post({ outreach_token: "not-a-token", email: "show@example.com" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid outreach token" });
    expect(getOutreachById).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps an unknown outreach as 404", async () => {
    const res = await post({
      outreach_token: tokenFor("missing"),
      email: "show@example.com",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Outreach not found" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps an invalid address as 400", async () => {
    const res = await post({ outreach_token: tokenFor("out-1"), email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid email" });
    expect(getOutreachById).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps missing fields and bad JSON as 400", async () => {
    const missing = await post({});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "outreach_token and email required" });

    const badJson = await POST(
      new NextRequest("https://www.taylslate.com/api/auth/magic/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "Invalid JSON" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns ok when the send fails", async () => {
    rows.set("out-1", { sent_to_email: "show@example.com" });
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "send_failed" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({
      outreach_token: tokenFor("out-1"),
      email: "show@example.com",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.flat().join(" ")).toContain("send_failed");
    error.mockRestore();
  });

  it("signs the recipient in from the link that was emailed", async () => {
    rows.set("out-1", { sent_to_email: "show@example.com" });
    const outreachToken = tokenFor("out-1");
    const res = await post({
      outreach_token: outreachToken,
      email: "show@example.com",
    });
    expect(res.status).toBe(200);
    const sent = sendEmail.mock.calls[0][0] as { html: string };
    const encoded = sent.html.match(/\/api\/auth\/magic\?token=([^"&\s<]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const magicToken = decodeURIComponent(encoded!);
    const follow = new URL("https://www.taylslate.com/api/auth/magic");
    follow.searchParams.set("token", magicToken);
    const landing = await GET(new NextRequest(follow));
    expect(landing.status).toBe(307);
    const location = landing.headers.get("location") ?? "";
    expect(location).toContain("token_hash=tok-hash");
    expect(location).toContain("type=magiclink");
    expect(location).toContain("next=%2Fonboarding%2Fshow");
    expect(landing.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe(
      `/outreach/${outreachToken}`,
    );
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "show@example.com" }),
    );
    expect(createUser).not.toHaveBeenCalled();
  });
});
