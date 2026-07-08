import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_OPTIONS } from "@/lib/auth/recovery-cookie";

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
  // Only clean same-origin absolute paths are allowed through: a single
  // leading slash, and neither a protocol-relative ("//") nor a
  // backslash-authority ("/\") prefix. This rejects "@evil/x" (no leading
  // slash), "//evil.com", and "https://evil.com/x" outright before parsing.
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return fallback;
  }
  try {
    // Defense in depth: resolve and re-confirm same-origin, keeping only the
    // path/query/hash so a later redirect can never leave our origin.
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
      if (type === "recovery") {
        // Mark that this session came from a password-recovery link so
        // /reset-password only shows the set-new-password form to a genuine
        // reset flow — never to an already-authenticated user who merely
        // navigated there (which would let a passwordless show account set a
        // password). Propagates on the redirect exactly like the session
        // cookies the Supabase server client just wrote.
        const cookieStore = await cookies();
        cookieStore.set(RECOVERY_COOKIE, "1", RECOVERY_COOKIE_OPTIONS);
      }
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
