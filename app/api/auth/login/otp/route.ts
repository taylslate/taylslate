// POST /api/auth/login/otp — email a 6-digit sign-in code.
// Any existing profile can use it (brand, agency, show, agent). The response
// is {ok:true} whether or not that address has an account. A pitch token is
// not a blank check: a missing profile is emailed a code only when the
// address is that outreach's contact, and the show account is created when
// the code is verified.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EMAIL_FROM_AUTH } from "@/lib/email/addresses";
import { sendEmail } from "@/lib/email/send";
import { renderLoginOtpEmail } from "@/lib/email/templates/login-otp";
import { verifyOutreachToken } from "@/lib/io/tokens";
import { getOutreachById } from "@/lib/data/queries";
import {
  isValidLoginEmail,
  isLoginMagicSignupLink,
  isLoginMagicUnknownUserError,
  loginMagicOtpOptions,
  normalizeLoginEmail,
  safeLoginNext,
  siteOriginFromRequest,
} from "@/lib/auth/login-magic";
import { isSixDigitCode } from "@/lib/auth/login-otp";
import {
  consumeLoginOtpLimit,
  hashLoginOtpCode,
  loginOtpClientIp,
  LOGIN_OTP_PENDING_MS,
  mintLoginOtpCode,
  type LoginOtpLimitDecision,
} from "@/lib/auth/login-otp-limit";

export const runtime = "nodejs";

interface OtpBody {
  email?: unknown;
  outreach_token?: unknown;
  next?: unknown;
}

interface ProfileHit {
  id: string;
  role: string;
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

export async function POST(request: NextRequest) {
  let body: OtpBody;
  try {
    body = (await request.json()) as OtpBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = normalizeLoginEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!isValidLoginEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const outreachToken =
    typeof body.outreach_token === "string" ? body.outreach_token : "";
  let outreachId = "";
  let outreachContactEmail = "";
  if (outreachToken) {
    const tokenPayload = verifyOutreachToken(outreachToken);
    if (!tokenPayload) {
      return NextResponse.json({ error: "Invalid outreach token" }, { status: 401 });
    }
    const outreach = await getOutreachById(tokenPayload.outreach_id);
    if (!outreach) {
      return NextResponse.json({ error: "Outreach not found" }, { status: 404 });
    }
    outreachId = tokenPayload.outreach_id;
    outreachContactEmail = normalizeLoginEmail(outreach.sent_to_email);
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) {
    console.error("[login.otp] profile lookup:", lookupError.message);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
  const profile = existing as ProfileHit | null;
  const ip = loginOtpClientIp(request.headers);

  let localCode: string | null = null;
  let pendingHash: string | null = null;
  let pendingOutreach: string | null = null;
  let pendingExpires: string | null = null;
  if (!profile && outreachId && outreachContactEmail === email) {
    localCode = mintLoginOtpCode();
    pendingHash = hashLoginOtpCode(email, localCode);
    pendingOutreach = outreachId;
    pendingExpires = new Date(Date.now() + LOGIN_OTP_PENDING_MS).toISOString();
  }

  const consumed = await consumeLoginOtpLimit({
    p_action: "send",
    p_email: email,
    p_ip: ip,
    p_pending_hash: pendingHash,
    p_pending_outreach: pendingOutreach,
    p_pending_expires: pendingExpires,
    p_clear_pending: Boolean(profile),
  });
  if (!consumed.ok) return unavailable();
  if (!consumed.decision.ok) return limited(consumed.decision);

  if (localCode) {
    const rendered = renderLoginOtpEmail({ code: localCode });
    const sendResult = await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: EMAIL_FROM_AUTH,
      bypassManagedReroute: true,
    });
    if (!sendResult.ok) {
      console.error("[login.otp] send failed:", sendResult.reason, sendResult.error);
      return NextResponse.json({ error: "send_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!profile) {
    return NextResponse.json({ ok: true });
  }

  const origin = siteOriginFromRequest(request.url);
  const nextPath = safeLoginNext(body.next, origin);
  const redirectTo = `${origin}/callback?next=${encodeURIComponent(nextPath)}`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: loginMagicOtpOptions(redirectTo),
  });
  const code = data?.properties?.email_otp;
  if (isLoginMagicSignupLink(data?.properties?.verification_type)) {
    const createdId = data?.user?.id;
    if (createdId) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdId);
      if (deleteError) {
        console.error("[login.otp] failed to roll back auto-created user:", deleteError.message);
      }
    }
    return NextResponse.json({ ok: true });
  }
  if (isLoginMagicUnknownUserError(error)) {
    return NextResponse.json({ ok: true });
  }
  if (error || !code || !isSixDigitCode(code)) {
    console.warn("[login.otp] generateLink:", error?.message ?? "no email code");
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  const rendered = renderLoginOtpEmail({ code });
  const sendResult = await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: EMAIL_FROM_AUTH,
    bypassManagedReroute: true,
  });
  if (!sendResult.ok) {
    console.error("[login.otp] send failed:", sendResult.reason, sendResult.error);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
