import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyLoginOtpRpc,
  hashLoginOtpCode,
  LOGIN_OTP_EMAIL_HOUR_MAX,
  LOGIN_OTP_HOUR_MS,
  LOGIN_OTP_IP_HOUR_MAX,
  LOGIN_OTP_PENDING_MS,
  LOGIN_OTP_WRONG_MAX,
  loginOtpClientIp,
  loginOtpEmailBucket,
  pendingLoginOtpMatches,
  type LoginOtpBucket,
  type LoginOtpRpcArgs,
} from "./login-otp-limit";

const HOUR = 60 * 60 * 1000;

function fresh() {
  const store = new Map<string, LoginOtpBucket>();
  let now = 1_700_000_000_000;
  const call = (args: LoginOtpRpcArgs) => applyLoginOtpRpc(store, args, now);
  return {
    store,
    call,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("applyLoginOtpRpc", () => {
  it("allows one send per 60 seconds and counts a rejected resend against the IP", () => {
    const { store, call } = fresh();
    const first = call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" });
    expect(first.ok).toBe(true);
    const second = call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" });
    expect(second.error).toBe("resend_wait");
    expect(second.retry_after_sec).toBeGreaterThan(0);
    expect(second.retry_after_sec).toBeLessThanOrEqual(60);
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.hourHits).toBe(1);
    expect(store.get("ip:1.1.1.1")?.hourHits).toBe(2);
  });

  it("lets a verify through during the send cooldown", () => {
    const { call, advance } = fresh();
    expect(call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
    advance(1_000);
    expect(call({ p_action: "verify", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
  });

  it("caps an email at 5 sends an hour, then allows another after the hour", () => {
    const { call, advance } = fresh();
    for (let i = 0; i < LOGIN_OTP_EMAIL_HOUR_MAX; i++) {
      expect(call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
      advance(61_000);
    }
    expect(call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" }).error).toBe(
      "hour_limit",
    );
    advance(HOUR);
    expect(call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
  });

  it("caps an IP at 20 an hour without charging the email that was blocked", () => {
    const { store, call } = fresh();
    for (let i = 0; i < LOGIN_OTP_IP_HOUR_MAX; i++) {
      expect(
        call({ p_action: "send", p_email: `u${i}@b.co`, p_ip: "9.9.9.9" }).ok,
      ).toBe(true);
    }
    const blocked = call({ p_action: "send", p_email: "victim@b.co", p_ip: "9.9.9.9" });
    expect(blocked.error).toBe("ip_limit");
    expect(store.get(loginOtpEmailBucket("victim@b.co"))?.hourHits ?? 0).toBe(0);
    expect(store.get("ip:9.9.9.9")?.hourHits).toBe(LOGIN_OTP_IP_HOUR_MAX);
  });

  it("counts five verifies with no wrong calls, then locks until a send", () => {
    const { store, call, advance } = fresh();
    expect(call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
    const actions: string[] = [];
    for (let i = 0; i < LOGIN_OTP_WRONG_MAX; i++) {
      const attempt = call({ p_action: "verify", p_email: "a@b.co", p_ip: "1.1.1.1" });
      actions.push("verify");
      expect(attempt.ok).toBe(true);
    }
    expect(actions).not.toContain("wrong");
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.wrongCodes).toBe(LOGIN_OTP_WRONG_MAX);
    expect(call({ p_action: "verify", p_email: "a@b.co", p_ip: "1.1.1.1" }).error).toBe(
      "locked",
    );
    const rejected = call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" });
    expect(rejected.error).toBe("resend_wait");
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.locked).toBe(true);
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.wrongCodes).toBe(LOGIN_OTP_WRONG_MAX);
    advance(61_000);
    expect(call({ p_action: "send", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.locked).toBe(false);
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.wrongCodes).toBe(0);
    expect(call({ p_action: "verify", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
  });

  it("resets the verify count on clear", () => {
    const { store, call } = fresh();
    for (let i = 0; i < 3; i++) {
      expect(call({ p_action: "verify", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
    }
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.wrongCodes).toBe(3);
    expect(call({ p_action: "clear", p_email: "a@b.co", p_ip: "1.1.1.1" }).ok).toBe(true);
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.wrongCodes).toBe(0);
    expect(store.get(loginOtpEmailBucket("a@b.co"))?.locked).toBe(false);
  });

  it("keeps a pending show code unless the send clears it", () => {
    const { store, call, advance } = fresh();
    const hash = hashLoginOtpCode("new@b.co", "482913");
    const expires = new Date(1_700_000_000_000 + HOUR).toISOString();
    expect(
      call({
        p_action: "send",
        p_email: "new@b.co",
        p_ip: "1.1.1.1",
        p_pending_hash: hash,
        p_pending_outreach: "out-1",
        p_pending_expires: expires,
      }).ok,
    ).toBe(true);
    advance(61_000);
    call({ p_action: "send", p_email: "new@b.co", p_ip: "1.1.1.1", p_clear_pending: false });
    expect(store.get(loginOtpEmailBucket("new@b.co"))?.pendingHash).toBe(hash);
    const verified = call({ p_action: "verify", p_email: "new@b.co", p_ip: "1.1.1.1" });
    expect(verified.pending_hash).toBe(hash);
    expect(verified.pending_outreach_id).toBe("out-1");
    expect(pendingLoginOtpMatches(verified.pending_hash, "new@b.co", "482913")).toBe(true);
    expect(pendingLoginOtpMatches(verified.pending_hash, "new@b.co", "000000")).toBe(false);
    advance(61_000);
    call({ p_action: "send", p_email: "new@b.co", p_ip: "1.1.1.1", p_clear_pending: true });
    expect(store.get(loginOtpEmailBucket("new@b.co"))?.pendingHash).toBeNull();
  });
});

describe("hashLoginOtpCode", () => {
  const prevMagic = process.env.MAGIC_LINK_TOKEN_SECRET;
  const prevOutreach = process.env.OUTREACH_TOKEN_SECRET;

  function restore() {
    if (prevMagic === undefined) delete process.env.MAGIC_LINK_TOKEN_SECRET;
    else process.env.MAGIC_LINK_TOKEN_SECRET = prevMagic;
    if (prevOutreach === undefined) delete process.env.OUTREACH_TOKEN_SECRET;
    else process.env.OUTREACH_TOKEN_SECRET = prevOutreach;
  }

  it("stays a plain hash until an existing server secret is set", () => {
    delete process.env.MAGIC_LINK_TOKEN_SECRET;
    delete process.env.OUTREACH_TOKEN_SECRET;
    try {
      const plain = hashLoginOtpCode("a@b.co", "482913");
      expect(plain).toBe(createHash("sha256").update("a@b.co:482913").digest("hex"));

      process.env.OUTREACH_TOKEN_SECRET = "existing-outreach-secret";
      expect(hashLoginOtpCode("a@b.co", "482913")).toBe(
        createHmac("sha256", "existing-outreach-secret").update("a@b.co:482913").digest("hex"),
      );

      process.env.MAGIC_LINK_TOKEN_SECRET = "existing-magic-secret-16";
      expect(hashLoginOtpCode("a@b.co", "482913")).toBe(
        createHmac("sha256", "existing-magic-secret-16").update("a@b.co:482913").digest("hex"),
      );
    } finally {
      restore();
    }
  });
});

describe("loginOtpClientIp", () => {
  it("prefers the Vercel forwarded hop over x-forwarded-for", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "198.51.100.20",
      "x-forwarded-for": "203.0.113.5, 10.0.0.1",
      "x-real-ip": "192.0.2.8",
    });
    expect(loginOtpClientIp(headers)).toBe("198.51.100.20");
  });

  it("uses the first forwarded hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.5, 10.0.0.1",
      "x-real-ip": "198.51.100.9",
    });
    expect(loginOtpClientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(loginOtpClientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
    expect(loginOtpClientIp(new Headers())).toBe("unknown");
  });
});

describe("migration 051", () => {
  const sql = readFileSync("supabase/migrations/051_login_otp_limits.sql", "utf8");

  it("is marked to apply and is service_role only", () => {
    expect(sql).toContain("MIGRATION TO APPLY");
    expect(sql.toLowerCase()).toContain("enable row level security");
    expect(sql.toLowerCase()).toContain("security invoker");
    expect(sql).toContain(
      "grant select, insert, update, delete on public.login_otp_limits to service_role",
    );
    expect(sql).toContain("revoke all on table public.login_otp_limits from public");
    expect(sql).toContain("revoke all on table public.login_otp_limits from anon");
    expect(sql).toContain("revoke all on table public.login_otp_limits from authenticated");
    expect(sql).toContain(
      "grant execute on function public.login_otp_consume(text, text, text, text, text, timestamptz, boolean) to service_role",
    );
    expect(sql.toLowerCase()).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(table\s+)?public\.login_otp_limits\s+to\s+(anon|authenticated|public)/,
    );
    expect(sql.toLowerCase()).not.toMatch(
      /grant execute on function public\.login_otp_consume\([^)]+\) to (anon|authenticated|public)/,
    );
  });

  it("matches the limiter thresholds", () => {
    expect(sql).toContain("v_ip.hour_hits >= 20");
    expect(sql).toContain("v_email.hour_hits >= 5");
    expect(sql).toContain("v_email.wrong_codes >= 5");
    expect(sql).toContain("interval '60 seconds'");
    expect(LOGIN_OTP_IP_HOUR_MAX).toBe(20);
    expect(LOGIN_OTP_EMAIL_HOUR_MAX).toBe(5);
    expect(LOGIN_OTP_WRONG_MAX).toBe(5);
  });

  it("expires a pending show contact code in 10 minutes", () => {
    expect(LOGIN_OTP_PENDING_MS).toBe(10 * 60 * 1000);
    expect(LOGIN_OTP_HOUR_MS).toBe(60 * 60 * 1000);
  });
});
