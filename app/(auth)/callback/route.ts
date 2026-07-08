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

// Resolve `next` to a guaranteed same-origin path. Without this, a value like
// "@evil.example/path" turns `${origin}${next}` into
// "https://host@evil.example/path" — an open redirect off the back of a
// successful auth callback. We keep only the path/query/hash of a same-origin
// resolution; anything cross-origin or unparseable falls back to /onboarding.
export function safeNextPath(next: string | null, origin: string): string {
  const fallback = "/onboarding";
  if (!next) return fallback;
  try {
    const resolved = new URL(next, origin);
    if (resolved.origin !== origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const nextPath = safeNextPath(searchParams.get("next"), origin);

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
      return NextResponse.redirect(`${origin}${nextPath}`);
    }
  } else if (code) {
    // PKCE branch: browser-initiated OTP with a stored code_verifier.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${nextPath}`);
    }
  }

  // Verification failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login`);
}
