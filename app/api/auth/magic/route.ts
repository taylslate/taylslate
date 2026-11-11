// GET /api/auth/magic?token=...
// Verifies a magic-link token, creates (or fetches) the matching auth user,
// inserts/updates the profiles row to role=show, signs them in via a magic
// callback, and redirects to onboarding. The return_url stored in the token
// will be honored after onboarding completes.

import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLinkToken, verifyOutreachToken } from "@/lib/io/tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listAuthUserIdsByEmail } from "@/lib/auth/auth-email";
import { normalizeLoginEmail } from "@/lib/auth/login-magic";
import { getOutreachById } from "@/lib/data/queries";
import {
  ONBOARDING_RETURN_COOKIE,
  ONBOARDING_RETURN_COOKIE_OPTIONS,
  sanitizeReturnPath,
} from "@/lib/auth/onboarding-return";
import { enforceAuthMagic } from "@/lib/security/rate-limit";

/**
 * The link is valid only when return_url is this origin and its path is
 * exactly /outreach/<token>, that token verifies, and the magic email is
 * that outreach's sent_to_email. Anything else is treated as expired.
 */
async function magicOutreachBinding(
  returnUrl: string,
  origin: string,
  email: string,
): Promise<{ url: URL } | null> {
  try {
    const url = new URL(returnUrl);
    if (url.origin !== origin) return null;
    const match = url.pathname.match(/^\/outreach\/([^/]+)$/);
    if (!match?.[1]) return null;
    const outreachToken = decodeURIComponent(match[1]);
    const tokenPayload = verifyOutreachToken(outreachToken);
    if (!tokenPayload) return null;
    const outreach = await getOutreachById(tokenPayload.outreach_id);
    if (!outreach) return null;
    if (normalizeLoginEmail(outreach.sent_to_email) !== email) return null;
    return { url };
  } catch {
    console.error("[magic] outreach binding failed");
    return null;
  }
}

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function GET(request: NextRequest) {
  const limited = await enforceAuthMagic(request);
  if (limited) return limited;

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const origin = siteOrigin(request);

  if (!token) {
    return NextResponse.redirect(`${origin}/auth/magic?error=missing_token`);
  }

  const payload = verifyMagicLinkToken(token);
  if (!payload) {
    return NextResponse.redirect(`${origin}/auth/magic?error=invalid_or_expired`);
  }

  const email = payload.email.trim().toLowerCase();
  const bound = await magicOutreachBinding(payload.return_url, origin, email);
  if (!bound) {
    return NextResponse.redirect(`${origin}/auth/magic?error=invalid_or_expired`);
  }

  // Find or create the auth user. The token email is matched on auth.users.
  // A profiles.email copy of that address is not an account.
  const directory = await listAuthUserIdsByEmail(email);
  if (!directory.ok || directory.ids.length > 1) {
    console.error("[magic] auth user lookup failed");
    return NextResponse.redirect(`${origin}/auth/magic?error=signin_failed`);
  }
  let userId: string | null = directory.ids[0] ?? null;

  if (!userId) {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { source: "magic_link" },
    });
    if (createErr || !created.user) {
      console.error("[magic] createUser failed:", createErr?.message);
      return NextResponse.redirect(`${origin}/auth/magic?error=signup_failed`);
    }
    userId = created.user.id;
    const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      email,
      full_name: "",
      role: "show",
      tier: "free",
    });
    if (profileErr) {
      console.error("[magic] profile insert failed:", profileErr.message);
      // Continue — the user exists in auth, can finish manually.
    }
  }

  // Generate a Supabase magic link the browser can follow to establish a
  // real session. The PKCE/OTP flow returns a hashed link; we extract the
  // action_link and redirect there.
  // Onboarding lands here; the pitch URL to return to afterward travels by
  // cookie (set on the response below), NOT a query param — the
  // /onboarding/show index redirect strips the query string, and "?return=..."
  // would collide with the onboarding edit-flow's "?return=summary" sentinel.
  const onboardingPath = "/onboarding/show";
  const redirectTo = `${origin}/callback?next=${encodeURIComponent(onboardingPath)}`;

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    console.error("[magic] generateLink failed:", linkErr?.message);
    return NextResponse.redirect(`${origin}/auth/magic?error=signin_failed`);
  }

  // Redirect to our own server-verifiable callback (verifyOtp on token_hash)
  // rather than generateLink's action_link, which returns the session in an
  // implicit-flow URL fragment that the /callback route handler can't read.
  const callbackUrl = `${origin}/callback?token_hash=${encodeURIComponent(
    linkData.properties.hashed_token
  )}&type=magiclink&next=${encodeURIComponent(onboardingPath)}`;

  const response = NextResponse.redirect(callbackUrl);

  // Carry the originating pitch URL (validated same-origin) so onboarding
  // completion can bounce the show straight back to accept/counter/decline.
  // The URL was parsed while binding the token to the outreach recipient.
  let returnPath: string | null = null;
  if (bound.url.origin === origin) {
    returnPath = sanitizeReturnPath(`${bound.url.pathname}${bound.url.search}`, origin);
  }
  if (returnPath) {
    response.cookies.set(ONBOARDING_RETURN_COOKIE, returnPath, ONBOARDING_RETURN_COOKIE_OPTIONS);
  }

  return response;
}
