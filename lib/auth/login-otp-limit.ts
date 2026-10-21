// Shared login-code limiter. The production counter is
// public.login_otp_consume (migration 051). applyLoginOtpRpc is the same
// rules in process, used by tests and kept in sync with that function.
//
// Send is 1 per 60 seconds and 5 per hour per email. Send and verify share
// 20 per hour per IP. Five wrong or expired codes lock that email until a
// send is accepted. A rejected resend does not clear the lock.
// Verify is allowed inside the 60 second send window.

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  LOGIN_OTP_RESEND_SEC,
  LOGIN_OTP_RESEND_WAIT,
} from "@/lib/auth/login-otp";

export const LOGIN_OTP_EMAIL_HOUR_MAX = 5;
export const LOGIN_OTP_IP_HOUR_MAX = 20;
export const LOGIN_OTP_WRONG_MAX = 5;
export const LOGIN_OTP_HOUR_MS = 60 * 60 * 1000;
export const LOGIN_OTP_PENDING_MS = 60 * 60 * 1000;

export const LOGIN_OTP_HOUR_LIMIT = "hour_limit";
export const LOGIN_OTP_IP_LIMIT = "ip_limit";
export const LOGIN_OTP_LOCKED = "locked";

export type LoginOtpLimitAction = "send" | "verify" | "wrong" | "clear";

export type LoginOtpLimitError =
  | typeof LOGIN_OTP_RESEND_WAIT
  | typeof LOGIN_OTP_HOUR_LIMIT
  | typeof LOGIN_OTP_IP_LIMIT
  | typeof LOGIN_OTP_LOCKED;

export interface LoginOtpBucket {
  hourStartedAt: number;
  hourHits: number;
  minuteStartedAt: number | null;
  wrongCodes: number;
  locked: boolean;
  pendingHash: string | null;
  pendingOutreachId: string | null;
  pendingExpiresAt: string | null;
}

export interface LoginOtpRpcArgs {
  p_action: LoginOtpLimitAction;
  p_email: string;
  p_ip: string;
  p_pending_hash?: string | null;
  p_pending_outreach?: string | null;
  p_pending_expires?: string | null;
  p_clear_pending?: boolean | null;
}

export interface LoginOtpLimitDecision {
  ok: boolean;
  error: LoginOtpLimitError | null;
  retry_after_sec: number;
  pending_hash: string | null;
  pending_outreach_id: string | null;
  pending_expires_at: string | null;
}

export function loginOtpEmailBucket(email: string): string {
  return `email:${email}`;
}

export function loginOtpIpBucket(ip: string): string {
  return `ip:${ip}`;
}

export function loginOtpClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  const raw = first || headers.get("x-real-ip")?.trim() || "unknown";
  const sliced = raw.slice(0, 64);
  return sliced || "unknown";
}

export function hashLoginOtpCode(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
}

export function mintLoginOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function pendingLoginOtpMatches(
  expectedHash: string | null,
  email: string,
  code: string,
): boolean {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashLoginOtpCode(email, code));
  const expected = Buffer.from(expectedHash);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function emptyBucket(now: number): LoginOtpBucket {
  return {
    hourStartedAt: now,
    hourHits: 0,
    minuteStartedAt: null,
    wrongCodes: 0,
    locked: false,
    pendingHash: null,
    pendingOutreachId: null,
    pendingExpiresAt: null,
  };
}

function rollHour(bucket: LoginOtpBucket, now: number): void {
  if (now - bucket.hourStartedAt >= LOGIN_OTP_HOUR_MS) {
    bucket.hourStartedAt = now;
    bucket.hourHits = 0;
  }
}

function secondsUntil(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1000));
}

function decision(
  ok: boolean,
  error: LoginOtpLimitError | null,
  retryAfterSec: number,
  pending?: Pick<
    LoginOtpBucket,
    "pendingHash" | "pendingOutreachId" | "pendingExpiresAt"
  > | null,
): LoginOtpLimitDecision {
  return {
    ok,
    error,
    retry_after_sec: ok ? 0 : retryAfterSec,
    pending_hash: ok && pending ? pending.pendingHash : null,
    pending_outreach_id: ok && pending ? pending.pendingOutreachId : null,
    pending_expires_at: ok && pending ? pending.pendingExpiresAt : null,
  };
}

/**
 * Mutates store. Mirrors public.login_otp_consume. Send and verify share the
 * IP window. The 60 second cooldown and the 5-per-hour cap count accepted
 * sends only. wrong and clear do not spend the IP budget; verify already did.
 */
export function applyLoginOtpRpc(
  store: Map<string, LoginOtpBucket>,
  args: LoginOtpRpcArgs,
  now = Date.now(),
): LoginOtpLimitDecision {
  const email = store.get(loginOtpEmailBucket(args.p_email)) ?? emptyBucket(now);
  const ip = store.get(loginOtpIpBucket(args.p_ip)) ?? emptyBucket(now);
  store.set(loginOtpEmailBucket(args.p_email), email);
  store.set(loginOtpIpBucket(args.p_ip), ip);
  rollHour(email, now);
  rollHour(ip, now);

  if (
    (args.p_action === "send" || args.p_action === "verify") &&
    ip.hourHits >= LOGIN_OTP_IP_HOUR_MAX
  ) {
    return decision(
      false,
      LOGIN_OTP_IP_LIMIT,
      secondsUntil(ip.hourStartedAt + LOGIN_OTP_HOUR_MS, now),
    );
  }

  if (args.p_action === "send") {
    if (
      email.minuteStartedAt !== null &&
      now - email.minuteStartedAt < LOGIN_OTP_RESEND_SEC * 1000
    ) {
      ip.hourHits += 1;
      return decision(
        false,
        LOGIN_OTP_RESEND_WAIT,
        secondsUntil(email.minuteStartedAt + LOGIN_OTP_RESEND_SEC * 1000, now),
      );
    }
    if (email.hourHits >= LOGIN_OTP_EMAIL_HOUR_MAX) {
      ip.hourHits += 1;
      return decision(
        false,
        LOGIN_OTP_HOUR_LIMIT,
        secondsUntil(email.hourStartedAt + LOGIN_OTP_HOUR_MS, now),
      );
    }
    email.hourHits += 1;
    email.minuteStartedAt = now;
    email.wrongCodes = 0;
    email.locked = false;
    if (args.p_pending_hash) {
      email.pendingHash = args.p_pending_hash;
      email.pendingOutreachId = args.p_pending_outreach ?? null;
      email.pendingExpiresAt = args.p_pending_expires ?? null;
    } else if (args.p_clear_pending) {
      email.pendingHash = null;
      email.pendingOutreachId = null;
      email.pendingExpiresAt = null;
    }
    ip.hourHits += 1;
    return decision(true, null, 0);
  }

  if (args.p_action === "verify") {
    ip.hourHits += 1;
    if (email.locked) {
      return decision(false, LOGIN_OTP_LOCKED, 0);
    }
    return decision(true, null, 0, email);
  }

  if (args.p_action === "wrong") {
    email.wrongCodes += 1;
    if (email.wrongCodes >= LOGIN_OTP_WRONG_MAX) email.locked = true;
    return decision(true, null, 0);
  }

  email.wrongCodes = 0;
  email.locked = false;
  email.pendingHash = null;
  email.pendingOutreachId = null;
  email.pendingExpiresAt = null;
  return decision(true, null, 0);
}

export async function consumeLoginOtpLimit(
  args: LoginOtpRpcArgs,
): Promise<{ ok: true; decision: LoginOtpLimitDecision } | { ok: false }> {
  const { data, error } = await supabaseAdmin.rpc("login_otp_consume", {
    p_action: args.p_action,
    p_email: args.p_email,
    p_ip: args.p_ip,
    p_pending_hash: args.p_pending_hash ?? null,
    p_pending_outreach: args.p_pending_outreach ?? null,
    p_pending_expires: args.p_pending_expires ?? null,
    p_clear_pending: args.p_clear_pending ?? false,
  });
  if (error || !data || typeof data !== "object") {
    console.error(
      "[login.otp.limit]",
      error?.message ?? "login_otp_consume returned nothing",
    );
    return { ok: false };
  }
  const row = data as LoginOtpLimitDecision;
  if (typeof row.ok !== "boolean") {
    console.error("[login.otp.limit] login_otp_consume returned an unexpected shape");
    return { ok: false };
  }
  return { ok: true, decision: row };
}
