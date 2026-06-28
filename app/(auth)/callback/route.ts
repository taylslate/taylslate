import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Email-OTP types we accept on the token_hash branch. Anything else falls
// through rather than being passed to verifyOtp.
const OTP_TYPES: string[] = [
  "magiclink",
  "email",
  "signup",
  "recovery",
  "invite",
  "email_change",
];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/onboarding";

  const supabase = await createClient();

  // token_hash branch: admin-minted magic links (founder test-login, show
  // onboarding) land here. generateLink returns a hashed_token we verify
  // server-side — no implicit-flow URL fragment, session cookies set directly.
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (code) {
    // PKCE branch: browser-initiated OTP with a stored code_verifier.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Verification failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login`);
}
