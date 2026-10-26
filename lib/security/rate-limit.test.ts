import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  LOGIN_CODE_SEND_EMAIL_MAX,
  LOGIN_CODE_SEND_EMAIL_WINDOW_SEC,
  LOGIN_CODE_SEND_IP_MAX,
  LOGIN_CODE_SEND_IP_WINDOW_SEC,
  LOGIN_CODE_VERIFY_MAX,
  LOGIN_CODE_VERIFY_WINDOW_SEC,
  OUTREACH_SEND_USER_DAY_MAX,
  OUTREACH_SEND_USER_DAY_WINDOW_SEC,
  OUTREACH_SEND_USER_HOUR_MAX,
  OUTREACH_SEND_USER_HOUR_WINDOW_SEC,
  RATE_LIMIT_MESSAGE,
  ROSTER_IMPORT_USER_HOUR_MAX,
  ROSTER_IMPORT_USER_HOUR_WINDOW_SEC,
  UPLOAD_USER_HOUR_MAX,
  UPLOAD_USER_HOUR_WINDOW_SEC,
  enforceAuthMagic,
  enforceLoginCodeSend,
  enforceLoginCodeVerify,
  enforceOutreachSend,
  enforceRosterImport,
  enforceRules,
  enforceUpload,
  hashRateLimitEmail,
  rateLimitClientIp,
} from "./rate-limit";

const {
  rpc,
  sendEmail,
  generateLink,
  deleteUser,
  createUser,
  from,
  verifyOutreachToken,
  getOutreachById,
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getCampaignById,
  createOutreach,
  getUserProfile,
  importShows,
  isShowsAdmin,
  getUser,
  verifyOtp,
  resendSend,
  resolveManagedDelivery,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  generateLink: vi.fn(),
  deleteUser: vi.fn(),
  createUser: vi.fn(),
  from: vi.fn(),
  verifyOutreachToken: vi.fn(),
  getOutreachById: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getBrandProfileByUserId: vi.fn(),
  getCampaignById: vi.fn(),
  createOutreach: vi.fn(),
  getUserProfile: vi.fn(),
  importShows: vi.fn(),
  isShowsAdmin: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  resendSend: vi.fn(),
  resolveManagedDelivery: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc,
    from,
    auth: { admin: { generateLink, deleteUser, createUser } },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, verifyOtp, signOut: async () => ({ error: null }) } }),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  resolveManagedDelivery: (...args: unknown[]) => resolveManagedDelivery(...args),
}));

vi.mock("@/lib/io/tokens", () => ({
  verifyOutreachToken: (...args: unknown[]) => verifyOutreachToken(...args),
  verifyMagicLinkToken: vi.fn(),
  signOutreachToken: (id: string) => `signed.${id}`,
}));

vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  createOutreach: (...args: unknown[]) => createOutreach(...args),
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
  importShows: (...args: unknown[]) => importShows(...args),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => isShowsAdmin(...args),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn() }),
}));

import { POST as sendLoginCode } from "@/app/api/auth/login/otp/route";
import { POST as verifyLoginCode } from "@/app/api/auth/login/otp/verify/route";
import { GET as openMagic } from "@/app/api/auth/magic/route";
import { POST as sendCampaignOutreach } from "@/app/api/campaigns/outreach/send/route";
import { POST as createOutreachPost } from "@/app/api/outreach/route";
import { POST as importDeal } from "@/app/api/deals/import/route";
import { POST as importShowsRoute } from "@/app/api/shows/import/route";
import { POST as previewMediaKit } from "@/app/api/show-profile/media-kit/route";

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

let nowMs = Date.UTC(2026, 0, 1);
let hits: Hit[] = [];
let profile: { id: string; role: string } | null = { id: "show-1", role: "show" };
let rpcError: { message: string } | null = null;

function allowHit(args: HitArgs): boolean {
  const windowMs = args.p_window_seconds * 1000;
  const recent = hits.filter(
    (hit) => hit.bucket === args.p_bucket && hit.key === args.p_key && nowMs - hit.at < windowMs,
  );
  if (recent.length >= args.p_max) return false;
  hits.push({ bucket: args.p_bucket, key: args.p_key, at: nowMs });
  return true;
}

function headers(ip = "203.0.113.5"): Headers {
  return new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` });
}

function jsonRequest(url: string, body: unknown, ip = "203.0.113.5"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `${ip}, 10.0.0.1`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  nowMs = Date.UTC(2026, 0, 1);
  hits = [];
  profile = { id: "show-1", role: "show" };
  rpcError = null;
  rpc.mockReset();
  sendEmail.mockReset();
  generateLink.mockReset();
  deleteUser.mockReset();
  createUser.mockReset();
  from.mockReset();
  verifyOutreachToken.mockReset();
  getOutreachById.mockReset();
  getAuthenticatedUser.mockReset();
  getBrandProfileByUserId.mockReset();
  getCampaignById.mockReset();
  createOutreach.mockReset();
  getUserProfile.mockReset();
  importShows.mockReset();
  isShowsAdmin.mockReset();
  getUser.mockReset();
  verifyOtp.mockReset();
  resendSend.mockReset();
  resolveManagedDelivery.mockReset();

  rpc.mockImplementation(async (name: string, args: HitArgs) => {
    if (rpcError) return { data: null, error: rpcError };
    if (name === "rate_limit_hit") return { data: allowHit(args), error: null };
    if (name === "login_otp_consume") {
      return {
        data: {
          ok: true,
          error: null,
          retry_after_sec: 0,
          pending_hash: null,
          pending_outreach_id: null,
          pending_expires_at: null,
        },
        error: null,
      };
    }
    return { data: null, error: { message: "unexpected rpc" } };
  });

  from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      update: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === "campaigns") {
          return {
            data: {
              id: "camp-1",
              user_id: "user-1",
              recommendations: [{ show_id: "show-1", contact_email: "host@show.example" }],
              youtube_recommendations: [],
              expansion_opportunities: [],
            },
            error: null,
          };
        }
        return { data: profile, error: null };
      }),
      single: vi.fn(async () => ({ data: { id: "o1", token: "signed.o1" }, error: null })),
      insert: vi.fn(async () => ({ error: null })),
    };
    return chain;
  });

  generateLink.mockResolvedValue({
    data: {
      user: { id: "show-1" },
      properties: { hashed_token: "tok", email_otp: "482913", verification_type: "magiclink" },
    },
    error: null,
  });
  sendEmail.mockResolvedValue({ ok: true, id: "msg_1" });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  getAuthenticatedUser.mockResolvedValue({ id: "user-1", email: "owner@example.com" });
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  getUserProfile.mockResolvedValue({ role: "agent", email: "rep@example.com" });
  isShowsAdmin.mockResolvedValue(false);
  importShows.mockResolvedValue({ imported: [], skipped: [], errors: [] });
  verifyOtp.mockResolvedValue({
    data: { user: null },
    error: { code: "otp_invalid", message: "Token has expired or is invalid" },
  });
  resendSend.mockResolvedValue({ data: { id: "msg" }, error: null });
  resolveManagedDelivery.mockImplementation(async (input: { to: string; subject: string }) => ({
    ok: true,
    to: input.to,
    subject: input.subject,
  }));
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("rate limit keys", () => {
  it("hashes the lowercased email and reads the first forwarded hop", () => {
    expect(hashRateLimitEmail(" Host@Example.com ")).toBe(hashRateLimitEmail("host@example.com"));
    expect(hashRateLimitEmail("host@example.com")).toMatch(/^[a-f0-9]{64}$/);
    expect(rateLimitClientIp(headers())).toBe("203.0.113.5");
    expect(rateLimitClientIp(new Headers({ "x-real-ip": " 198.51.100.20 " }))).toBe("198.51.100.20");
    expect(rateLimitClientIp(new Headers())).toBe("unknown");
  });

  it("sends the email hash and the IP as separate keys", async () => {
    const res = await enforceLoginCodeSend({ headers: headers() }, "Host@Example.com");
    expect(res).toBeNull();
    expect(rpc).toHaveBeenNthCalledWith(1, "rate_limit_hit", {
      p_bucket: "login_code_send_email",
      p_key: hashRateLimitEmail("host@example.com"),
      p_max: LOGIN_CODE_SEND_EMAIL_MAX,
      p_window_seconds: LOGIN_CODE_SEND_EMAIL_WINDOW_SEC,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "rate_limit_hit", {
      p_bucket: "login_code_send_ip",
      p_key: "203.0.113.5",
      p_max: LOGIN_CODE_SEND_IP_MAX,
      p_window_seconds: LOGIN_CODE_SEND_IP_WINDOW_SEC,
    });
  });
});

describe("each limit trips and resets", () => {
  async function trip(
    run: () => Promise<Response | null>,
    max: number,
    windowSec: number,
  ) {
    for (let i = 0; i < max; i++) {
      expect(await run()).toBeNull();
    }
    const denied = await run();
    expect(denied?.status).toBe(429);
    expect(denied?.headers.get("Retry-After")).toBe(String(windowSec));
    expect(await denied?.json()).toEqual({ error: RATE_LIMIT_MESSAGE });
    nowMs += windowSec * 1000;
    expect(await run()).toBeNull();
  }

  it("limits login code sends per email and per IP", async () => {
    await trip(
      () => enforceLoginCodeSend({ headers: headers("203.0.113.8") }, "one@example.com"),
      LOGIN_CODE_SEND_EMAIL_MAX,
      LOGIN_CODE_SEND_EMAIL_WINDOW_SEC,
    );

    hits = [];
    nowMs = Date.UTC(2026, 0, 1);
    for (let i = 0; i < LOGIN_CODE_SEND_IP_MAX; i++) {
      const res = await enforceLoginCodeSend(
        { headers: headers("203.0.113.9") },
        `person-${i}@example.com`,
      );
      expect(res).toBeNull();
    }
    const blocked = await enforceLoginCodeSend(
      { headers: headers("203.0.113.9") },
      "someone-else@example.com",
    );
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_IP_WINDOW_SEC));
    nowMs += LOGIN_CODE_SEND_IP_WINDOW_SEC * 1000;
    expect(
      await enforceLoginCodeSend({ headers: headers("203.0.113.9") }, "later@example.com"),
    ).toBeNull();
  });

  it("locks verify after 5 tries and clears when the window ends", async () => {
    await trip(
      () => enforceLoginCodeVerify("host@example.com"),
      LOGIN_CODE_VERIFY_MAX,
      LOGIN_CODE_VERIFY_WINDOW_SEC,
    );
  });

  it("limits outreach sends per hour and per day", async () => {
    await trip(
      () => enforceOutreachSend("user-hour"),
      OUTREACH_SEND_USER_HOUR_MAX,
      OUTREACH_SEND_USER_HOUR_WINDOW_SEC,
    );

    hits = [];
    nowMs = Date.UTC(2026, 0, 1);
    // Stay under the hourly cap so the 101st request is the daily cap.
    let made = 0;
    while (made < OUTREACH_SEND_USER_DAY_MAX) {
      const room = Math.min(OUTREACH_SEND_USER_HOUR_MAX - 1, OUTREACH_SEND_USER_DAY_MAX - made);
      for (let i = 0; i < room; i++) {
        expect(await enforceOutreachSend("user-day")).toBeNull();
        made += 1;
      }
      if (made < OUTREACH_SEND_USER_DAY_MAX) {
        nowMs += OUTREACH_SEND_USER_HOUR_WINDOW_SEC * 1000;
      }
    }
    const denied = await enforceOutreachSend("user-day");
    expect(denied?.status).toBe(429);
    expect(denied?.headers.get("Retry-After")).toBe(String(OUTREACH_SEND_USER_DAY_WINDOW_SEC));
    nowMs += OUTREACH_SEND_USER_DAY_WINDOW_SEC * 1000;
    expect(await enforceOutreachSend("user-day")).toBeNull();
  });

  it("limits uploads per user and per IP", async () => {
    await trip(
      () => enforceUpload({ headers: headers() }, "user-1"),
      UPLOAD_USER_HOUR_MAX,
      UPLOAD_USER_HOUR_WINDOW_SEC,
    );
    expect(await enforceUpload({ headers: headers() }, "user-2")).toBeNull();

    hits = [];
    nowMs = Date.UTC(2026, 0, 1);
    await trip(
      () => enforceUpload({ headers: headers("198.51.100.7") }, null),
      UPLOAD_USER_HOUR_MAX,
      UPLOAD_USER_HOUR_WINDOW_SEC,
    );
    const ipKey = hits.find((hit) => hit.bucket === "upload_user_hour")?.key;
    expect(ipKey).toBe("ip:198.51.100.7");
  });

  it("limits roster import per user per hour", async () => {
    await trip(
      () => enforceRosterImport("agent-1"),
      ROSTER_IMPORT_USER_HOUR_MAX,
      ROSTER_IMPORT_USER_HOUR_WINDOW_SEC,
    );
  });
});

describe("limiter failures", () => {
  it("fails closed on code send and outreach send", async () => {
    rpcError = { message: "database unavailable" };
    const send = await enforceLoginCodeSend({ headers: headers() }, "host@example.com");
    const outreach = await enforceOutreachSend("user-1");
    expect(send?.status).toBe(503);
    expect(outreach?.status).toBe(503);
    expect(await send?.json()).toEqual({ error: "unavailable" });
    expect(await outreach?.json()).toEqual({ error: "unavailable" });
    expect(send?.headers.get("Retry-After")).toBeNull();
  });

  it("fails open on a read", async () => {
    rpcError = { message: "database unavailable" };
    const open = await enforceRules({
      failureMode: "open",
      rules: [
        {
          bucket: "read_user_hour",
          key: "user-1",
          max: 10,
          windowSeconds: 60,
        },
      ],
    });
    expect(open).toBeNull();
  });
});

describe("login code routes", () => {
  it("returns the same body for a known and an unknown email", async () => {
    profile = { id: "show-1", role: "show" };
    const known = await sendLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp", { email: "known@example.com" }),
    );
    profile = null;
    const unknown = await sendLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp", { email: "unknown@example.com" }, "203.0.113.6"),
    );
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual({ ok: true });
    expect(await unknown.json()).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    for (let i = 0; i < LOGIN_CODE_SEND_EMAIL_MAX; i++) {
      const again = await sendLoginCode(
        jsonRequest("https://www.taylslate.com/api/auth/login/otp", { email: "same@example.com" }, "203.0.113.20"),
      );
      expect(again.status).toBe(200);
    }
    profile = { id: "show-1", role: "show" };
    const knownLimited = await sendLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp", { email: "same@example.com" }, "203.0.113.20"),
    );
    profile = null;
    const unknownLimited = await sendLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp", { email: "same@example.com" }, "203.0.113.20"),
    );
    const knownBody = await knownLimited.json();
    const unknownBody = await unknownLimited.json();
    expect(knownLimited.status).toBe(429);
    expect(unknownLimited.status).toBe(429);
    expect(knownLimited.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_EMAIL_WINDOW_SEC));
    expect(unknownLimited.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_EMAIL_WINDOW_SEC));
    expect(knownBody).toEqual(unknownBody);
    expect(knownBody).toEqual({ error: RATE_LIMIT_MESSAGE });
  });

  it("fails closed before a code is emailed", async () => {
    rpcError = { message: "connection refused" };
    const res = await sendLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp", { email: "host@example.com" }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("locks verify on the route and allows it again after the window", async () => {
    for (let i = 0; i < LOGIN_CODE_VERIFY_MAX; i++) {
      const res = await verifyLoginCode(
        jsonRequest("https://www.taylslate.com/api/auth/login/otp/verify", {
          email: "host@example.com",
          code: "000000",
        }),
      );
      expect(res.status).toBe(400);
    }
    const locked = await verifyLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp/verify", {
        email: "host@example.com",
        code: "111111",
      }),
    );
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(verifyOtp).toHaveBeenCalledTimes(LOGIN_CODE_VERIFY_MAX);

    nowMs += LOGIN_CODE_VERIFY_WINDOW_SEC * 1000;
    const again = await verifyLoginCode(
      jsonRequest("https://www.taylslate.com/api/auth/login/otp/verify", {
        email: "host@example.com",
        code: "222222",
      }),
    );
    expect(again.status).toBe(400);
  });
});

describe("wired routes", () => {
  it("keeps an under-limit magic link redirect and then returns 429", async () => {
    const first = await openMagic(
      new NextRequest("https://www.taylslate.com/api/auth/magic", {
        headers: { "x-forwarded-for": "203.0.113.40" },
      }),
    );
    expect(first.status).toBe(307);
    expect(first.headers.get("location")).toContain("error=missing_token");

    for (let i = 1; i < LOGIN_CODE_SEND_IP_MAX; i++) {
      const ok = await openMagic(
        new NextRequest("https://www.taylslate.com/api/auth/magic", {
          headers: { "x-forwarded-for": "203.0.113.40" },
        }),
      );
      expect(ok.status).toBe(307);
    }
    const blocked = await openMagic(
      new NextRequest("https://www.taylslate.com/api/auth/magic", {
        headers: { "x-forwarded-for": "203.0.113.40" },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe(String(LOGIN_CODE_SEND_IP_WINDOW_SEC));
  });

  it("stops campaign outreach send at the limit and still sends under it", async () => {
    const draft = {
      show_id: "show-1",
      show_name: "Daily",
      contact_email: "host@show.example",
      subject: "Hello",
      body: "A short note about the test flight.",
    };
    const send = () =>
      sendCampaignOutreach(
        jsonRequest("https://www.taylslate.com/api/campaigns/outreach/send", {
          campaign_id: "camp-1",
          drafts: [draft],
        }, "203.0.113.50"),
      );

    const ok = await send();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      results: [{ show_id: "show-1", success: true, to: "host@show.example" }],
    });

    for (let i = 1; i < OUTREACH_SEND_USER_HOUR_MAX; i++) {
      expect((await send()).status).toBe(200);
    }
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(resendSend).toHaveBeenCalledTimes(OUTREACH_SEND_USER_HOUR_MAX);

    rpcError = { message: "database unavailable" };
    hits = [];
    const closed = await send();
    expect(closed.status).toBe(503);
    expect(resendSend).toHaveBeenCalledTimes(OUTREACH_SEND_USER_HOUR_MAX);
  });

  it("stops POST /api/outreach before it creates a row", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "user-9" });
    for (let i = 0; i < OUTREACH_SEND_USER_HOUR_MAX; i++) {
      hits.push({
        bucket: "outreach_send_user_hour",
        key: "user-9",
        at: nowMs,
      });
    }
    const res = await createOutreachPost(
      jsonRequest("https://www.taylslate.com/api/outreach", { campaign_id: "c1" }),
    );
    expect(res.status).toBe(429);
    expect(createOutreach).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps an under-limit upload response and then returns 429", async () => {
    const plain = await importDeal(
      new NextRequest("https://www.taylslate.com/api/deals/import", {
        method: "POST",
        headers: { "content-type": "text/plain", "x-forwarded-for": "203.0.113.70" },
        body: "hello",
      }),
    );
    expect(plain.status).toBe(415);

    const kit = await previewMediaKit(
      jsonRequest("https://www.taylslate.com/api/show-profile/media-kit", {
        text: "United States 62%\nCanada 8%",
      }, "203.0.113.71"),
    );
    expect(kit.status).toBe(200);
    expect(await kit.json()).toEqual({
      text: "United States 62%\nCanada 8%",
      geography: { us: 62, canada: 8 },
    });

    const show = await importShowsRoute(
      jsonRequest("https://www.taylslate.com/api/shows/import", {
        shows: [{ name: "Night Desk", platform: "podcast" }],
      }, "203.0.113.72"),
    );
    expect(show.status).toBe(200);
    expect(importShows).toHaveBeenCalledTimes(1);

    for (let i = 1; i < UPLOAD_USER_HOUR_MAX; i++) {
      hits.push({ bucket: "upload_user_hour", key: "user-1", at: nowMs });
    }
    const blockedKit = await previewMediaKit(
      jsonRequest("https://www.taylslate.com/api/show-profile/media-kit", { text: "United States 10%" }),
    );
    expect(blockedKit.status).toBe(429);
    expect(blockedKit.headers.get("Retry-After")).toBe(String(UPLOAD_USER_HOUR_WINDOW_SEC));

    const blockedShow = await importShowsRoute(
      jsonRequest("https://www.taylslate.com/api/shows/import", {
        shows: [{ name: "Night Desk", platform: "podcast" }],
      }),
    );
    expect(blockedShow.status).toBe(429);
    expect(importShows).toHaveBeenCalledTimes(1);
  });
});
