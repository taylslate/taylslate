// Short-lived marker cookie set by /callback ONLY after a password-recovery
// link (type=recovery) is verified. /reset-password requires it before showing
// the set-new-password form, so an already-authenticated user — e.g. a
// passwordless magic-link show account, or any logged-in brand — can't reach
// the form without a genuine reset link. It gates form visibility only; the
// actual password change is still authorized by the Supabase session.
export const RECOVERY_COOKIE = "tslate_pw_recovery";

export const RECOVERY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 600, // 10 minutes — a reset link is used promptly or re-requested
} as const;
