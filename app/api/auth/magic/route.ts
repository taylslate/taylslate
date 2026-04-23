// GET /api/auth/magic?token=...
// Verifies a magic-link token, creates (or fetches) the matching auth user,
// inserts/updates the profiles row to role=show, signs them in via a magic
// callback, and redirects to onboarding. The return_url stored in the token
// will be honored after onboarding completes.

import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLinkToken } from "@/lib/io/tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function GET(request: NextRequest) {
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

  // Find or create the auth user.
  const email = payload.email;
  let userId: string | null = null;

  const { data: existingByEmail } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existingByEmail?.id) {
    userId = existingByEmail.id;
  } else {
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
  const returnAfterOnboarding = encodeURIComponent(payload.return_url);
  const onboardingPath = `/onboarding/show?return=${returnAfterOnboarding}`;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(onboardingPath)}`;

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (linkErr || !linkData.properties?.action_link) {
    console.error("[magic] generateLink failed:", linkErr?.message);
    return NextResponse.redirect(`${origin}/auth/magic?error=signin_failed`);
  }

  return NextResponse.redirect(linkData.properties.action_link);
}
