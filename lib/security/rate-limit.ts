// Shared server rate limits. The counter is public.rate_limit_hit
// (migration 073). Keys are a sha256 of the lowercased email, the
// user id, or the client IP. No new service and no new env var.
//
// Over the limit: 429, Retry-After, and a generic message.
// If the function itself fails: code send, verify, magic, outreach
// sends, and uploads fail closed. Pass failureMode "open" for a
// read. No read route is wired in this job.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const LOGIN_CODE_SEND_EMAIL_MAX = 3;
export const LOGIN_CODE_SEND_EMAIL_WINDOW_SEC = 15 * 60;
export const LOGIN_CODE_SEND_IP_MAX = 10;
export const LOGIN_CODE_SEND_IP_WINDOW_SEC = 60 * 60;
export const LOGIN_CODE_VERIFY_MAX = 5;
export const LOGIN_CODE_VERIFY_WINDOW_SEC = 15 * 60;
export const OUTREACH_SEND_USER_HOUR_MAX = 20;
export const OUTREACH_SEND_USER_HOUR_WINDOW_SEC = 60 * 60;
export const OUTREACH_SEND_USER_DAY_MAX = 100;
export const OUTREACH_SEND_USER_DAY_WINDOW_SEC = 24 * 60 * 60;
export const UPLOAD_USER_HOUR_MAX = 20;
export const UPLOAD_USER_HOUR_WINDOW_SEC = 60 * 60;
// B1 roster import keeps its 500-row and 1 MB caps. 10 requests
// an hour is 5,000 rows, enough for preview, commit, and a retry.
export const ROSTER_IMPORT_USER_HOUR_MAX = 10;
export const ROSTER_IMPORT_USER_HOUR_WINDOW_SEC = 60 * 60;
export const ROSTER_DISPUTE_USER_HOUR_MAX = 10;
export const ROSTER_DISPUTE_USER_HOUR_WINDOW_SEC = 60 * 60;

export const RATE_LIMIT_MESSAGE = "Too many requests. Try again later.";

const LOGIN_CODE_SEND_EMAIL_BUCKET = "login_code_send_email";
const LOGIN_CODE_SEND_IP_BUCKET = "login_code_send_ip";
const LOGIN_CODE_VERIFY_BUCKET = "login_code_verify_email";
const AUTH_MAGIC_IP_BUCKET = "auth_magic_ip";
const OUTREACH_SEND_HOUR_BUCKET = "outreach_send_user_hour";
const OUTREACH_SEND_DAY_BUCKET = "outreach_send_user_day";
const UPLOAD_USER_HOUR_BUCKET = "upload_user_hour";
const ROSTER_IMPORT_HOUR_BUCKET = "roster_import_user_hour";
const ROSTER_DISPUTE_HOUR_BUCKET = "roster_dispute_user_hour";

export type RateLimitFailureMode = "closed" | "open";

export interface RateLimitRule {
  bucket: string;
  key: string;
  max: number;
  windowSeconds: number;
}

type HeaderSource = { headers: Headers };

export function hashRateLimitEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** First hop of x-forwarded-for, then x-real-ip. */
export function rateLimitClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hop = forwarded.split(",")[0]?.trim() ?? "";
    if (hop) return hop.slice(0, 128);
  }
  const real = headers.get("x-real-ip")?.trim() ?? "";
  if (real) return real.slice(0, 128);
  return "unknown";
}

export function rateLimitDenied(retryAfterSec: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSec));
  return NextResponse.json(
    { error: RATE_LIMIT_MESSAGE },
    {
      status: 429,
      headers: { "Retry-After": String(seconds) },
    },
  );
}

export function rateLimitUnavailable(): NextResponse {
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

export async function hitRateLimit(
  rule: RateLimitRule,
): Promise<{ ok: true; allowed: boolean } | { ok: false }> {
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      p_bucket: rule.bucket,
      p_key: rule.key,
      p_max: rule.max,
      p_window_seconds: rule.windowSeconds,
    });
    if (error || typeof data !== "boolean") {
      console.error(
        "[rate-limit]",
        error?.message ?? "rate_limit_hit returned nothing",
      );
      return { ok: false };
    }
    return { ok: true, allowed: data };
  } catch (err) {
    console.error(
      "[rate-limit]",
      err instanceof Error ? err.message : "rate_limit_hit failed",
    );
    return { ok: false };
  }
}

export async function enforceRules(input: {
  rules: RateLimitRule[];
  failureMode: RateLimitFailureMode;
}): Promise<NextResponse | null> {
  for (const rule of input.rules) {
    const hit = await hitRateLimit(rule);
    if (!hit.ok) {
      if (input.failureMode === "open") return null;
      return rateLimitUnavailable();
    }
    if (!hit.allowed) return rateLimitDenied(rule.windowSeconds);
  }
  return null;
}

export function enforceLoginCodeSend(
  request: HeaderSource,
  email: string,
): Promise<NextResponse | null> {
  const ip = rateLimitClientIp(request.headers);
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: LOGIN_CODE_SEND_EMAIL_BUCKET,
        key: hashRateLimitEmail(email),
        max: LOGIN_CODE_SEND_EMAIL_MAX,
        windowSeconds: LOGIN_CODE_SEND_EMAIL_WINDOW_SEC,
      },
      {
        bucket: LOGIN_CODE_SEND_IP_BUCKET,
        key: ip,
        max: LOGIN_CODE_SEND_IP_MAX,
        windowSeconds: LOGIN_CODE_SEND_IP_WINDOW_SEC,
      },
    ],
  });
}

export function enforceLoginCodeVerify(email: string): Promise<NextResponse | null> {
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: LOGIN_CODE_VERIFY_BUCKET,
        key: hashRateLimitEmail(email),
        max: LOGIN_CODE_VERIFY_MAX,
        windowSeconds: LOGIN_CODE_VERIFY_WINDOW_SEC,
      },
    ],
  });
}

export function enforceAuthMagic(request: HeaderSource): Promise<NextResponse | null> {
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: AUTH_MAGIC_IP_BUCKET,
        key: rateLimitClientIp(request.headers),
        max: LOGIN_CODE_SEND_IP_MAX,
        windowSeconds: LOGIN_CODE_SEND_IP_WINDOW_SEC,
      },
    ],
  });
}

export function enforceOutreachSend(userId: string): Promise<NextResponse | null> {
  const key = userId.trim();
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: OUTREACH_SEND_HOUR_BUCKET,
        key,
        max: OUTREACH_SEND_USER_HOUR_MAX,
        windowSeconds: OUTREACH_SEND_USER_HOUR_WINDOW_SEC,
      },
      {
        bucket: OUTREACH_SEND_DAY_BUCKET,
        key,
        max: OUTREACH_SEND_USER_DAY_MAX,
        windowSeconds: OUTREACH_SEND_USER_DAY_WINDOW_SEC,
      },
    ],
  });
}

/**
 * userId when the caller already has a session. Null keys the IP,
 * which is how POST /api/deals/import is limited: that handler's
 * PDF branch does not load a user.
 */
export function enforceUpload(
  request: HeaderSource,
  userId: string | null,
): Promise<NextResponse | null> {
  const id = userId?.trim() ?? "";
  const key = id ? id : `ip:${rateLimitClientIp(request.headers)}`;
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: UPLOAD_USER_HOUR_BUCKET,
        key,
        max: UPLOAD_USER_HOUR_MAX,
        windowSeconds: UPLOAD_USER_HOUR_WINDOW_SEC,
      },
    ],
  });
}

/**
 * POST /api/reps/roster/import calls this after requireAgent and
 * before the body is read. That route keeps the 500-row and 1 MB caps.
 */
export function enforceRosterImport(userId: string): Promise<NextResponse | null> {
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: ROSTER_IMPORT_HOUR_BUCKET,
        key: userId.trim(),
        max: ROSTER_IMPORT_USER_HOUR_MAX,
        windowSeconds: ROSTER_IMPORT_USER_HOUR_WINDOW_SEC,
      },
    ],
  });
}

/** POST /api/roster-links/[id]/dispute. 10 per hour per signed-in user. Closed on failure. */
export function enforceRosterDispute(userId: string): Promise<NextResponse | null> {
  return enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: ROSTER_DISPUTE_HOUR_BUCKET,
        key: userId.trim(),
        max: ROSTER_DISPUTE_USER_HOUR_MAX,
        windowSeconds: ROSTER_DISPUTE_USER_HOUR_WINDOW_SEC,
      },
    ],
  });
}
