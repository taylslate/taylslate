// Shared helpers for the /login magic-link path.
//
// Login does not create accounts (signup does). generateLink for an unknown
// email fails; the API still returns 200 so account existence never leaks.

export const LOGIN_NEXT_FALLBACK = "/dashboard";

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
