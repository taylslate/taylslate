// One email-code sign-in for brands and shows.
//
// An existing profile of any role can receive a code. The response does not
// say whether that address has an account. A show profile is created only
// when a pitch code is verified and the address is still that outreach's
// contact. /dashboard still sends a brand to brand onboarding and a show to
// show onboarding.

export const LOGIN_OTP_EXPIRED = "expired";
export const LOGIN_OTP_INVALID = "invalid_code";
export const LOGIN_OTP_RESEND_WAIT = "resend_wait";

/** Matches the send cooldown in lib/auth/login-otp-limit.ts. */
export const LOGIN_OTP_RESEND_SEC = 60;
export const LOGIN_OTP_LENGTH = 6;

export function normalizeLoginOtp(code: unknown): string {
  if (typeof code !== "string") return "";
  return code.replace(/\s+/g, "");
}

export function isSixDigitCode(code: string): boolean {
  return new RegExp(`^[0-9]{${LOGIN_OTP_LENGTH}}$`).test(code);
}

/**
 * GoTrue uses `otp_expired` when the 6-digit code is past its window.
 * A wrong code comes back as a different code, often with a message that
 * also contains the word "expired" ("Token has expired or is invalid"),
 * so the error code wins over the message.
 */
export function classifyEmailOtpError(
  error: { message?: string; code?: string } | null | undefined,
): "expired" | "invalid" {
  const code = (error?.code ?? "").toLowerCase();
  if (code === "otp_expired") return "expired";
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("expired") && !message.includes("invalid")) return "expired";
  return "invalid";
}

const BRAND_SIDE_ROLES = new Set(["brand", "agency"]);
const SHOW_SIDE_ROLES = new Set(["show", "agent"]);

function pathOnly(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

function isUnder(path: string, prefix: string): boolean {
  const bare = pathOnly(path);
  return bare === prefix || bare.startsWith(`${prefix}/`);
}

/**
 * Keep an explicit same-origin next path. Send a brand who was pointed at
 * show onboarding, or a show pointed at brand onboarding, to /dashboard.
 * The dashboard layout is what finishes the role split.
 */
export function nextAfterCodeLogin(role: string, requested: string): string {
  if (BRAND_SIDE_ROLES.has(role) && isUnder(requested, "/onboarding/show")) {
    return "/dashboard";
  }
  if (SHOW_SIDE_ROLES.has(role) && isUnder(requested, "/onboarding/brand")) {
    return "/dashboard";
  }
  return requested;
}

export function loginOtpErrorMessage(
  code: string | undefined,
  phase: "request" | "verify",
): string {
  switch (code) {
    case LOGIN_OTP_EXPIRED:
      return "That code has expired. Request a new one.";
    case LOGIN_OTP_INVALID:
      return "That code doesn't match. Try again.";
    case LOGIN_OTP_RESEND_WAIT:
      return "Wait a minute before requesting another code.";
    case "hour_limit":
    case "ip_limit":
      return "Too many attempts. Try again later.";
    case "locked":
      return "Too many attempts. Request a new code.";
    case "email required":
    case "invalid email":
      return "Enter your email.";
    default:
      return phase === "verify"
        ? "Could not sign you in. Try again."
        : "Could not send the code. Try again.";
  }
}
