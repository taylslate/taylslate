// Shared helpers for the /login magic-link path.
//
// Login does not create accounts (signup does). The login OTP/generateLink
// call always sets shouldCreateUser: false. Unknown emails return no_account
// so /login can point the user at /signup.

export const LOGIN_NEXT_FALLBACK = "/dashboard";

/** API error body when generateLink/OTP finds no existing auth user. */
export const LOGIN_MAGIC_NO_ACCOUNT = "no_account";

/** Must be false — login must not mint an auth user. Signup does that. */
export const LOGIN_MAGIC_SHOULD_CREATE_USER = false;

const LOGIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeLoginEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function isValidLoginEmail(email: string): boolean {
  return LOGIN_EMAIL_RE.test(email);
}

/**
 * Accept only a clean same-origin path. Rejects protocol-relative, backslash
 * authority, non-path, and cross-origin values. Falls back to /dashboard —
 * the role-aware home that already routes brand vs show.
 */
export function safeLoginNext(next: unknown, origin: string): string {
  if (typeof next !== "string" || !next) return LOGIN_NEXT_FALLBACK;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return LOGIN_NEXT_FALLBACK;
  }
  try {
    const resolved = new URL(next, origin);
    if (resolved.origin !== origin) return LOGIN_NEXT_FALLBACK;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return LOGIN_NEXT_FALLBACK;
  }
}

export function siteOriginFromRequest(url: string): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(url).origin;
}

/**
 * Options for the login magic-link OTP (admin generateLink, the server
 * equivalent of signInWithOtp). shouldCreateUser is always false.
 */
export function loginMagicOtpOptions(redirectTo: string): {
  redirectTo: string;
  shouldCreateUser: false;
} {
  return {
    redirectTo,
    shouldCreateUser: LOGIN_MAGIC_SHOULD_CREATE_USER,
  };
}

/** GoTrue converts unknown-email magiclink generateLink into a signup. */
export function isLoginMagicSignupLink(
  verificationType: string | null | undefined,
): boolean {
  return verificationType === "signup";
}

export function isLoginMagicUnknownUserError(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "user_not_found" ||
    message.includes("user not found") ||
    message.includes("user with this email not found")
  );
}
