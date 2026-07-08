// Cloudflare Turnstile helpers for the bot-signup protection layer.
//
// Turnstile runs as the provider inside Supabase's built-in Auth CAPTCHA: the
// widget lives on the client, the resulting token is threaded into the Supabase
// auth call as `captchaToken`, and the Turnstile SECRET is entered in the
// Supabase dashboard (never in our env). There is NO custom verification route.
//
// Everything here is pure and React-free so the token/error logic is testable
// in isolation (see turnstile.test.ts). The widget lifecycle lives in
// components/auth/turnstile-widget.tsx.

// The public site key, inlined at build time by Next.js. Unset in local dev,
// which disables the widget entirely (see turnstileEnabled) — Supabase only
// enforces CAPTCHA when it is enabled server-side, so auth degrades gracefully.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Whether the Turnstile widget should render at all. When the site key is
// absent (local dev, or before the Vercel env var is set) we skip the widget
// and auth calls proceed without a captchaToken.
export function turnstileEnabled(siteKey: string = TURNSTILE_SITE_KEY): boolean {
  return siteKey.trim().length > 0;
}

// Thread a captcha token into a Supabase auth options object ONLY when a token
// is present. When Turnstile is disabled (no token) the options are returned
// unchanged — byte-identical to the pre-Turnstile behaviour — so the call has
// no hard dependency on the widget and works in local dev.
export function withCaptchaToken<T extends object>(
  options: T,
  token: string | undefined | null,
): T & { captchaToken?: string } {
  if (!token) return options;
  return { ...options, captchaToken: token };
}

// Friendly copy shown when Supabase rejects the captcha. We reset the widget
// and ask the user to retry rather than surfacing the raw Supabase error.
export const CAPTCHA_RETRY_MESSAGE =
  "We couldn't verify you're human. Please try again.";

// Supabase surfaces a captcha verification failure with a message that mentions
// "captcha" (e.g. "captcha verification process failed"). Detect it so we can
// swap in friendly retry copy; all other errors pass through unchanged.
export function isCaptchaError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /captcha/i.test(message);
}
