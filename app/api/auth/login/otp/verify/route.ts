// POST /api/auth/login/otp/verify — exchange a 6-digit code for a session.
// verifyOtp runs on the server client so the session cookies are set here.
// A pitch code for an address with no profile creates the show account here,
// then opens the session from the admin link's hashed token. Brand and show
// profiles both stay signed in. /dashboard applies the existing role redirects.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyOutreachToken } from "@/lib/io/tokens";
import { getOutreachById } from "@/lib/data/queries";
import {
  normalizeLoginEmail,
  isValidLoginEmail,
  safeLoginNext,
  siteOriginFromRequest,
  loginMagicOtpOptions,
  isLoginMagicSignupLink,
} from "@/lib/auth/login-magic";
import {
  classifyEmailOtpError,
  isSixDigitCode,
  LOGIN_OTP_EXPIRED,
  LOGIN_OTP_INVALID,
  nextAfterCodeLogin,
  normalizeLoginOtp,
} from "@/lib/auth/login-otp";
import {
  consumeLoginOtpLimit,
  loginOtpClientIp,
  pendingLoginOtpMatches,
  type LoginOtpLimitDecision,
} from "@/lib/auth/login-otp-limit";
import { createShowAccount } from "@/lib/auth/login-otp-show";
import {
  ONBOARDING_RETURN_COOKIE,
  ONBOARDING_RETURN_COOKIE_OPTIONS,
  sanitizeReturnPath,
} from "@/lib/auth/onboarding-return";

export const runtime = "nodejs";

interface VerifyBody {
  email?: unknown;
  code?: unknown;
  next?: unknown;
  outreach_token?: unknown;
}

interface ProfileHit {
  id: string;
  role: string | null;
}

function unavailable() {
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

function limited(decision: LoginOtpLimitDecision) {
  return NextResponse.json(
    { error: decision.error, retry_after_sec: decision.retry_after_sec },
    { status: 429 },
  );
}

async function recordWrong(email: string, ip: string) {
  const recorded = await consumeLoginOtpLimit({
    p_action: "wrong",
    p_email: email,
    p_ip: ip,
  });
  if (!recorded.ok) {
    console.error("[login.otp.verify] could not record a failed code");
  }
}

async function finish(
  request: NextRequest,
  body: VerifyBody,
  role: string,
) {
  const outreachToken =
    typeof body.outreach_token === "string" ? body.outreach_token : "";
  if (outreachToken && verifyOutreachToken(outreachToken)) {
    const origin = siteOriginFromRequest(request.url);
    const returnPath = sanitizeReturnPath(`/outreach/${outreachToken}`, origin);
    if (returnPath) {
      const cookieStore = await cookies();
      cookieStore.set(
        ONBOARDING_RETURN_COOKIE,
        returnPath,
        ONBOARDING_RETURN_COOKIE_OPTIONS,
      );
    }
  }

  const origin = siteOriginFromRequest(request.url);
  const next = nextAfterCodeLogin(role, safeLoginNext(body.next, origin));
  await consumeLoginOtpLimit({
    p_action: "clear",
    p_email: normalizeLoginEmail(body.email),
    p_ip: loginOtpClientIp(request.headers),
  });
  return NextResponse.json({ ok: true, next });
}

export async function POST(request: NextRequest) {
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = normalizeLoginEmail(body.email);
  if (!email || !isValidLoginEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const code = normalizeLoginOtp(body.code);
  if (!isSixDigitCode(code)) {
    return NextResponse.json({ error: LOGIN_OTP_INVALID }, { status: 400 });
  }

  const ip = loginOtpClientIp(request.headers);
  const consumed = await consumeLoginOtpLimit({
    p_action: "verify",
    p_email: email,
    p_ip: ip,
  });
  if (!consumed.ok) return unavailable();
  if (!consumed.decision.ok) return limited(consumed.decision);

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) {
    console.error("[login.otp.verify] profile lookup:", lookupError.message);
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }
  const profile = existing as ProfileHit | null;

  if (profile) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error || !data.user) {
      await recordWrong(email, ip);
      const kind = classifyEmailOtpError(error);
      return NextResponse.json(
        { error: kind === "expired" ? LOGIN_OTP_EXPIRED : LOGIN_OTP_INVALID },
        { status: 400 },
      );
    }
    if (!profile.role || data.user.id !== profile.id) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "verify_failed" }, { status: 403 });
    }
    return finish(request, body, profile.role);
  }

  const pending = consumed.decision;
  const expiresAt = pending.pending_expires_at
    ? Date.parse(pending.pending_expires_at)
    : Number.NaN;
  const matches = pendingLoginOtpMatches(pending.pending_hash, email, code);
  if (!matches || !pending.pending_outreach_id || !Number.isFinite(expiresAt)) {
    await recordWrong(email, ip);
    return NextResponse.json({ error: LOGIN_OTP_INVALID }, { status: 400 });
  }
  if (expiresAt <= Date.now()) {
    await recordWrong(email, ip);
    return NextResponse.json({ error: LOGIN_OTP_EXPIRED }, { status: 400 });
  }

  const outreach = await getOutreachById(pending.pending_outreach_id);
  if (!outreach || normalizeLoginEmail(outreach.sent_to_email) !== email) {
    await recordWrong(email, ip);
    return NextResponse.json({ error: LOGIN_OTP_INVALID }, { status: 400 });
  }

  const created = await createShowAccount(email);
  if (!created.ok) {
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }

  const origin = siteOriginFromRequest(request.url);
  const nextPath = safeLoginNext(body.next, origin);
  const redirectTo = `${origin}/callback?next=${encodeURIComponent(nextPath)}`;
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: loginMagicOtpOptions(redirectTo),
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash || isLoginMagicSignupLink(link?.properties?.verification_type)) {
    const createdId = link?.user?.id;
    if (isLoginMagicSignupLink(link?.properties?.verification_type) && createdId) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdId);
      if (deleteError) {
        console.error("[login.otp.verify] failed to roll back signup link:", deleteError.message);
      }
    }
    console.error("[login.otp.verify] generateLink:", linkError?.message ?? "no hashed token");
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (sessionError || !session.user || session.user.id !== created.userId) {
    if (session.user) await supabase.auth.signOut();
    console.error("[login.otp.verify] session:", sessionError?.message ?? "user mismatch");
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }

  return finish(request, body, "show");
}
