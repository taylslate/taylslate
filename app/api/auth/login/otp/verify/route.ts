// POST /api/auth/login/otp/verify — exchange a 6-digit show code for a session.
// verifyOtp runs on the server client so the session cookies are set here.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyOutreachToken } from "@/lib/io/tokens";
import {
  normalizeLoginEmail,
  isValidLoginEmail,
  safeLoginNext,
  siteOriginFromRequest,
} from "@/lib/auth/login-magic";
import {
  classifyEmailOtpError,
  isSixDigitCode,
  LOGIN_OTP_EXPIRED,
  LOGIN_OTP_INVALID,
  LOGIN_OTP_NOT_SHOW,
  normalizeLoginOtp,
} from "@/lib/auth/login-otp";
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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error || !data.user) {
    const kind = classifyEmailOtpError(error);
    return NextResponse.json(
      { error: kind === "expired" ? LOGIN_OTP_EXPIRED : LOGIN_OTP_INVALID },
      { status: 400 },
    );
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("[login.otp.verify] profile lookup:", profileError.message);
    await supabase.auth.signOut();
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }
  if (!profile || profile.role !== "show") {
    await supabase.auth.signOut();
    return NextResponse.json({ error: LOGIN_OTP_NOT_SHOW }, { status: 403 });
  }

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
  const next = safeLoginNext(body.next, origin);
  return NextResponse.json({ ok: true, next });
}
