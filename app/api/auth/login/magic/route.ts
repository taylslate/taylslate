// POST /api/auth/login/magic — email a sign-in link for an existing account.
// Same path for brands and shows; role is already on the profile.
// Does not create users. Unknown emails return 404 no_account.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { renderLoginMagicEmail } from "@/lib/email/templates/login-magic";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import {
  isValidLoginEmail,
  normalizeLoginEmail,
  safeLoginNext,
  siteOriginFromRequest,
  loginMagicOtpOptions,
  isLoginMagicSignupLink,
  isLoginMagicUnknownUserError,
  LOGIN_MAGIC_NO_ACCOUNT,
} from "@/lib/auth/login-magic";

export const runtime = "nodejs";

interface MagicBody {
  email?: unknown;
  next?: unknown;
}

export async function POST(request: NextRequest) {
  let body: MagicBody;
  try {
    body = (await request.json()) as MagicBody;
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

  const origin = siteOriginFromRequest(request.url);
  const nextPath = safeLoginNext(body.next, origin);
  const limit = checkRateLimit(`login-magic:${email}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ ok: true });
  }

  const redirectTo = `${origin}/callback?next=${encodeURIComponent(nextPath)}`;
  // generateLink is the server equivalent of signInWithOtp. GoTrue has no
  // shouldCreateUser on this endpoint and converts unknown emails to signup,
  // so we pass the flag for the contract and roll back verification_type=signup.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: loginMagicOtpOptions(redirectTo),
  });
  const tokenHash = data?.properties?.hashed_token;
  if (isLoginMagicSignupLink(data?.properties?.verification_type)) {
    const createdId = data?.user?.id;
    if (createdId) {
      const { error: deleteError } =
        await supabaseAdmin.auth.admin.deleteUser(createdId);
      if (deleteError) {
        console.error(
          "[login.magic] failed to roll back auto-created user:",
          deleteError.message,
        );
      }
    }
    return NextResponse.json(
      { error: LOGIN_MAGIC_NO_ACCOUNT },
      { status: 404 },
    );
  }
  if (isLoginMagicUnknownUserError(error)) {
    return NextResponse.json(
      { error: LOGIN_MAGIC_NO_ACCOUNT },
      { status: 404 },
    );
  }
  if (error || !tokenHash) {
    // generateLink rejected the redirect URL. Redirect URLs in Supabase Auth
    // must include localhost and https://www.taylslate.com.
    console.warn("[login.magic] generateLink:", error?.message ?? "no token");
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  const loginUrl = `${origin}/callback?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=magiclink&next=${encodeURIComponent(nextPath)}`;
  const rendered = renderLoginMagicEmail({ login_url: loginUrl });
  const sendResult = await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: "Taylslate <auth@taylslate.com>",
  });
  if (!sendResult.ok) {
    console.error("[login.magic] send failed:", sendResult.reason, sendResult.error);
  }

  return NextResponse.json({ ok: true });
}
