// POST /api/auth/login/otp — email a 6-digit sign-in code to a show.
// Brands stay on the magic-link path. Unknown emails are not created
// unless the body carries a valid outreach token (show setup from a pitch).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EMAIL_FROM_AUTH } from "@/lib/email/addresses";
import { sendEmail } from "@/lib/email/send";
import { renderLoginOtpEmail } from "@/lib/email/templates/login-otp";
import { checkRateLimit } from "@/lib/utils/rate-limit";
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
import {
  isSixDigitCode,
  LOGIN_OTP_NO_ACCOUNT,
  LOGIN_OTP_NOT_SHOW,
  LOGIN_OTP_RESEND_SEC,
  LOGIN_OTP_RESEND_WAIT,
} from "@/lib/auth/login-otp";

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
  if (outreachToken) {
    const tokenPayload = verifyOutreachToken(outreachToken);
    if (!tokenPayload) {
      return NextResponse.json({ error: "Invalid outreach token" }, { status: 401 });
    }
    const outreach = await getOutreachById(tokenPayload.outreach_id);
    if (!outreach) {
      return NextResponse.json({ error: "Outreach not found" }, { status: 404 });
    }
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .ilike("email", email)
    .maybeSingle();
  if (lookupError) {
    console.error("[login.otp] profile lookup:", lookupError.message);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
  const profile = existing as ProfileHit | null;
  if (profile && profile.role !== "show") {
    return NextResponse.json({ error: LOGIN_OTP_NOT_SHOW }, { status: 403 });
  }
  if (!profile && !outreachToken) {
    return NextResponse.json({ error: LOGIN_OTP_NO_ACCOUNT }, { status: 404 });
  }

  const limit = checkRateLimit(
    `login-otp:${email}`,
    1,
    LOGIN_OTP_RESEND_SEC * 1000,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: LOGIN_OTP_RESEND_WAIT, retry_after_sec: limit.retryAfterSec },
      { status: 429 },
    );
  }

  let createdUserId: string | null = null;
  if (!profile) {
    const created = await createShowAccount(email);
    if (!created.ok) {
      return NextResponse.json({ error: "send_failed" }, { status: 500 });
    }
    createdUserId = created.userId;
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
  const mintedSignup = isLoginMagicSignupLink(data?.properties?.verification_type);
  if (mintedSignup && !createdUserId) {
    const createdId = data?.user?.id;
    if (createdId) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdId);
      if (deleteError) {
        console.error("[login.otp] failed to roll back auto-created user:", deleteError.message);
      }
    }
    return NextResponse.json({ error: LOGIN_OTP_NO_ACCOUNT }, { status: 404 });
  }
  if (!createdUserId && isLoginMagicUnknownUserError(error)) {
    return NextResponse.json({ error: LOGIN_OTP_NO_ACCOUNT }, { status: 404 });
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

async function createShowAccount(
  email: string,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { source: "email_code" },
  });
  if (createErr || !created?.user) {
    console.error("[login.otp] createUser failed:", createErr?.message);
    return { ok: false };
  }
  const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
    id: created.user.id,
    email,
    full_name: "",
    role: "show",
    tier: "free",
  });
  if (profileErr) {
    console.error("[login.otp] profile insert failed:", profileErr.message);
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("[login.otp] failed to roll back show user:", deleteError.message);
    }
    return { ok: false };
  }
  return { ok: true, userId: created.user.id };
}
