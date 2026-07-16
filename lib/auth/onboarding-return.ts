// Short-lived cookie that carries the public pitch URL a show should be returned
// to after it finishes onboarding. Set at the magic-link landing
// (/api/auth/magic) when the token carried a return_url; read + cleared by
// /api/show-profile/complete, which hands the path back to the client for a HARD
// navigation (window.location.assign) so the pitch page's server component re-runs
// and the now-onboarded show sees "Accept offer" immediately.
//
// This is deliberately SEPARATE from the onboarding "?return=summary" edit-flow
// sentinel: that query param means "jump back to the summary step," a different
// concern that would collide if we reused it for the pitch return. The pitch
// return travels by cookie so it survives the /onboarding/show index redirect,
// which strips the query string.
export const ONBOARDING_RETURN_COOKIE = "tslate_onboarding_return";

export const ONBOARDING_RETURN_COOKIE_OPTIONS = {
  httpOnly: true, // server sets it, /complete reads it and returns the path in JSON
  secure: true,
  sameSite: "lax", // survives the top-level magic-link navigation
  path: "/", // must reach both /onboarding/* and /api/show-profile/complete
  maxAge: 3600, // 1 hour — onboarding is ~3 min; generous buffer for a slow setup
} as const;

/**
 * Accept only a clean same-origin path to redirect back to. Rejects
 * protocol-relative ("//host"), backslash-authority ("/\host"), non-path, and
 * cross-origin inputs so a tampered cookie can never drive an open redirect.
 * Returns the path (+ query) or null. Mirrors the /callback safeNextPath guard.
 */
export function sanitizeReturnPath(
  raw: string | null | undefined,
  origin: string
): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return null;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return null;
  }
}
