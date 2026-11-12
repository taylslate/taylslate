// POST /api/auth/login/otp/verify — exchange a 6-digit code for a session.
// verifyOtp runs on the server client so the session cookies are set here.
// A pitch code for an address with no profile creates the show account here,
// then opens the session from the admin link's hashed token. A show sign-up
// code (pending marker "show_signup", R1) does the same without an outreach
// row and defaults next to /onboarding/show. Brand and show profiles both
// stay signed in. /dashboard applies the existing role redirects.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listAuthUserIdsByEmail } from "@/lib/auth/auth-email";
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
  SHOW_SIGNUP_PENDING,
} from "@/lib/auth/login-otp";
import {
  consumeLoginOtpLimit,
  loginOtpClientIp,
  pendingLoginOtpMatches,
  type LoginOtpLimitDecision,
} from "@/lib/auth/login-otp-limit";
import { createShowAccount } from "@/lib/auth/login-otp-show";
import { enforceLoginCodeVerify } from "@/lib/security/rate-limit";
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

/** Codes and session outcomes must never be cached by any intermediary. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function unavailable() {
  return noStore(NextResponse.json({ error: "unavailable" }, { status: 503 }));
}

function limited(decision: LoginOtpLimitDecision) {
  return noStore(
    NextResponse.json(
      { error: decision.error, retry_after_sec: decision.retry_after_sec },
      { status: 429 },
    ),
  );
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
  return noStore(NextResponse.json({ ok: true, next }));
}

export async function POST(request: NextRequest) {
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return noStore(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const email = normalizeLoginEmail(body.email);
  if (!email || !isValidLoginEmail(email)) {
    return noStore(NextResponse.json({ error: "invalid email" }, { status: 400 }));
  }
  const code = normalizeLoginOtp(body.code);
  if (!isSixDigitCode(code)) {
    return noStore(NextResponse.json({ error: LOGIN_OTP_INVALID }, { status: 400 }));
  }

  const rateLimited = await enforceLoginCodeVerify(email);
  if (rateLimited) return noStore(rateLimited);

  const ip = loginOtpClientIp(request.headers);
  // The verify action increments wrong_codes under the email row lock and
  // refuses when the count is already 5. A later call would let parallel
  // guesses all pass the check.
  const consumed = await consumeLoginOtpLimit({
    p_action: "verify",
    p_email: email,
    p_ip: ip,
  });
  if (!consumed.ok) return unavailable();
  if (!consumed.decision.ok) return limited(consumed.decision);

  const directory = await listAuthUserIdsByEmail(email);
  if (!directory.ok || directory.ids.length > 1) {
    console.error("[login.otp.verify] auth user lookup failed");
    return noStore(NextResponse.json({ error: "verify_failed" }, { status: 500 }));
  }
  const authUserId = directory.ids[0] ?? null;

  if (authUserId) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error || !data.user) {
      const kind = classifyEmailOtpError(error);
      return noStore(
        NextResponse.json(
          { error: kind === "expired" ? LOGIN_OTP_EXPIRED : LOGIN_OTP_INVALID },
          { status: 400 },
        ),
      );
    }
    if (data.user.id !== authUserId) {
      await supabase.auth.signOut();
      return noStore(NextResponse.json({ error: "verify_failed" }, { status: 403 }));
    }
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (lookupError) {
      console.error("[login.otp.verify] profile lookup:", lookupError.message);
      await supabase.auth.signOut();
      return noStore(NextResponse.json({ error: "verify_failed" }, { status: 500 }));
    }
    const profile = existing as ProfileHit | null;
    if (!profile?.role || profile.id !== data.user.id) {
      await supabase.auth.signOut();
      return noStore(NextResponse.json({ error: "verify_failed" }, { status: 403 }));
    }
    return finish(request, body, profile.role);
  }

  const pending = consumed.decision;
  const expiresAt = pending.pending_expires_at
    ? Date.parse(pending.pending_expires_at)
    : Number.NaN;
  const matches = pendingLoginOtpMatches(pending.pending_hash, email, code);
  if (!matches || !pending.pending_outreach_id || !Number.isFinite(expiresAt)) {
    return noStore(NextResponse.json({ error: LOGIN_OTP_INVALID }, { status: 400 }));
  }
  if (expiresAt <= Date.now()) {
    return noStore(NextResponse.json({ error: LOGIN_OTP_EXPIRED }, { status: 400 }));
  }

  // The show_signup marker (R1) is a sign-up with no outreach row. Everything
  // else in pending_outreach_id is an outreach id whose contact must still be
  // this address. The created role is always the literal "show" from
  // createShowAccount, never a value from the request.
  const isShowSignup = pending.pending_outreach_id === SHOW_SIGNUP_PENDING;
  if (!isShowSignup) {
    const outreach = await getOutreachById(pending.pending_outreach_id);
    if (!outreach || normalizeLoginEmail(outreach.sent_to_email) !== email) {
      return noStore(NextResponse.json({ error: LOGIN_OTP_INVALID }, { status: 400 }));
    }
  }

  const created = await createShowAccount(
    email,
    isShowSignup ? "show_signup" : "email_code",
  );
  if (!created.ok) {
    return noStore(NextResponse.json({ error: "verify_failed" }, { status: 500 }));
  }

  // A show sign-up with no explicit next lands in show onboarding.
  // safeLoginNext and nextAfterCodeLogin still apply on the way out.
  const effectiveBody: VerifyBody =
    isShowSignup && !(typeof body.next === "string" && body.next)
      ? { ...body, next: "/onboarding/show" }
      : body;

  const origin = siteOriginFromRequest(request.url);
  const nextPath = safeLoginNext(effectiveBody.next, origin);
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
    return noStore(NextResponse.json({ error: "verify_failed" }, { status: 500 }));
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (sessionError || !session.user || session.user.id !== created.userId) {
    if (session.user) await supabase.auth.signOut();
    console.error("[login.otp.verify] session:", sessionError?.message ?? "user mismatch");
    return noStore(NextResponse.json({ error: "verify_failed" }, { status: 500 }));
  }

  return finish(request, effectiveBody, "show");
}
