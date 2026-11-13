// POST /api/auth/login/otp — email a 6-digit sign-in code.
// Any existing profile can use it (brand, agency, show, agent). The response
// is {ok:true} whether or not that address has an account. A pitch token is
// not a blank check: a missing profile is emailed a code only when the
// address is that outreach's contact, and the show account is created when
// the code is verified. A show sign-up (intent "show_signup", R1) mints a
// code for an address with no auth user and no outreach token; the account
// is created when that code is verified. An existing user with a profile
// still keeps their role. A no-profile auth user is finished on verify.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listAuthUserIdsByEmail } from "@/lib/auth/auth-email";
import { EMAIL_FROM_AUTH } from "@/lib/email/addresses";
import { sendEmail } from "@/lib/email/send";
import { renderLoginOtpEmail } from "@/lib/email/templates/login-otp";
import { verifyOutreachToken } from "@/lib/io/tokens";
import { getOutreachById } from "@/lib/data/queries";
import {
  isValidLoginEmail,
  isLoginMagicSignupLink,
  isLoginMagicUnknownUserError,
  loginMagicOtpOptions,
  normalizeLoginEmail,
  safeLoginNext,
  siteOriginFromRequest,
} from "@/lib/auth/login-magic";
import {
  isSixDigitCode,
  SHOW_SIGNUP_INTENT,
  SHOW_SIGNUP_PENDING,
} from "@/lib/auth/login-otp";
import {
  consumeLoginOtpLimit,
  hashLoginOtpCode,
  loginOtpClientIp,
  LOGIN_OTP_PENDING_MS,
  mintLoginOtpCode,
  type LoginOtpLimitDecision,
} from "@/lib/auth/login-otp-limit";
import {
  enforceLoginCodeSend,
  enforceRules,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const SHOW_SIGNUP_IP_DAY_BUCKET = "show_signup_ip_day";
const SHOW_SIGNUP_IP_DAY_MAX = 10;
const SHOW_SIGNUP_IP_DAY_WINDOW_SEC = 24 * 60 * 60;

interface OtpBody {
  email?: unknown;
  outreach_token?: unknown;
  next?: unknown;
  intent?: unknown;
}

/** Codes and decoy answers must never be cached by any intermediary. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function unavailable() {
  return noStore(NextResponse.json({ error: "unavailable" }, { status: 503 }));
}

function limited(decision: LoginOtpLimitDecision) {
  return noStore(
    NextResponse.json(
      { error: decision.error, retry_after_sec: decision.retry_after_sec },
      { status: 429 },
    ),
  );
}

export async function POST(request: NextRequest) {
  let body: OtpBody;
  try {
    body = (await request.json()) as OtpBody;
  } catch {
    return noStore(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const email = normalizeLoginEmail(body.email);
  if (!email) {
    return noStore(NextResponse.json({ error: "email required" }, { status: 400 }));
  }
  if (!isValidLoginEmail(email)) {
    return noStore(NextResponse.json({ error: "invalid email" }, { status: 400 }));
  }

  // Only the exact string counts. Any other value, and any role or tier
  // field, is ignored; the role is never read from the request.
  const showSignupIntent = body.intent === SHOW_SIGNUP_INTENT;

  const outreachToken =
    typeof body.outreach_token === "string" ? body.outreach_token : "";
  let outreachId = "";
  let outreachContactEmail = "";
  if (outreachToken) {
    const tokenPayload = verifyOutreachToken(outreachToken);
    if (!tokenPayload) {
      return noStore(
        NextResponse.json({ error: "Invalid outreach token" }, { status: 401 }),
      );
    }
    const outreach = await getOutreachById(tokenPayload.outreach_id);
    if (!outreach) {
      return noStore(
        NextResponse.json({ error: "Outreach not found" }, { status: 404 }),
      );
    }
    outreachId = tokenPayload.outreach_id;
    outreachContactEmail = normalizeLoginEmail(outreach.sent_to_email);
  }

  const rateLimited = await enforceLoginCodeSend(request, email);
  if (rateLimited) return noStore(rateLimited);

  if (showSignupIntent) {
    // Every show-signup request spends this budget, whether or not the
    // address has an account, so timing does not reveal accounts.
    const signupLimited = await enforceRules({
      failureMode: "closed",
      rules: [
        {
          bucket: SHOW_SIGNUP_IP_DAY_BUCKET,
          key: loginOtpClientIp(request.headers),
          max: SHOW_SIGNUP_IP_DAY_MAX,
          windowSeconds: SHOW_SIGNUP_IP_DAY_WINDOW_SEC,
        },
      ],
    });
    if (signupLimited) return noStore(signupLimited);
  }

  const directory = await listAuthUserIdsByEmail(email);
  if (!directory.ok || directory.ids.length > 1) {
    console.error("[login.otp] auth user lookup failed");
    return noStore(NextResponse.json({ error: "send_failed" }, { status: 500 }));
  }
  const authUserId = directory.ids[0] ?? null;
  const ip = loginOtpClientIp(request.headers);

  let localCode: string | null = null;
  let pendingHash: string | null = null;
  let pendingOutreach: string | null = null;
  let pendingExpires: string | null = null;
  let clearPending = Boolean(authUserId);
  if (!authUserId && outreachId && outreachContactEmail === email) {
    localCode = mintLoginOtpCode();
    pendingHash = hashLoginOtpCode(email, localCode);
    pendingOutreach = outreachId;
    pendingExpires = new Date(Date.now() + LOGIN_OTP_PENDING_MS).toISOString();
  } else if (!authUserId && !outreachToken && showSignupIntent) {
    // Show sign-up: no account yet. The account itself is created only when
    // this code is verified.
    localCode = mintLoginOtpCode();
    pendingHash = hashLoginOtpCode(email, localCode);
    pendingOutreach = SHOW_SIGNUP_PENDING;
    pendingExpires = new Date(Date.now() + LOGIN_OTP_PENDING_MS).toISOString();
  } else if (authUserId && !outreachToken && showSignupIntent) {
    // The generateLink code is what we email. This hash only exists so the
    // limiter keeps the show_signup marker until verify. The minted code
    // is never sent. No profile is read or written here.
    const markerCode = mintLoginOtpCode();
    pendingHash = hashLoginOtpCode(email, markerCode);
    pendingOutreach = SHOW_SIGNUP_PENDING;
    pendingExpires = new Date(Date.now() + LOGIN_OTP_PENDING_MS).toISOString();
    clearPending = false;
  }

  const consumed = await consumeLoginOtpLimit({
    p_action: "send",
    p_email: email,
    p_ip: ip,
    p_pending_hash: pendingHash,
    p_pending_outreach: pendingOutreach,
    p_pending_expires: pendingExpires,
    p_clear_pending: clearPending,
  });
  if (!consumed.ok) return unavailable();
  if (!consumed.decision.ok) return limited(consumed.decision);

  if (localCode) {
    const rendered = renderLoginOtpEmail({ code: localCode });
    const sendResult = await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: EMAIL_FROM_AUTH,
      bypassManagedReroute: true,
    });
    if (!sendResult.ok) {
      console.error("[login.otp] send failed:", sendResult.reason, sendResult.error);
      return noStore(NextResponse.json({ error: "send_failed" }, { status: 500 }));
    }
    return noStore(NextResponse.json({ ok: true }));
  }

  if (!authUserId) {
    return noStore(NextResponse.json({ ok: true }));
  }

  const origin = siteOriginFromRequest(request.url);
  const nextPath = safeLoginNext(body.next, origin);
  const redirectTo = `${origin}/callback?next=${encodeURIComponent(nextPath)}`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: loginMagicOtpOptions(redirectTo),
  });
  const code = data?.properties?.email_otp;
  if (isLoginMagicSignupLink(data?.properties?.verification_type)) {
    const createdId = data?.user?.id;
    if (createdId) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdId);
      if (deleteError) {
        console.error("[login.otp] failed to roll back auto-created user:", deleteError.message);
      }
    }
    return noStore(NextResponse.json({ ok: true }));
  }
  if (isLoginMagicUnknownUserError(error)) {
    return noStore(NextResponse.json({ ok: true }));
  }
  if (error || !code || !isSixDigitCode(code)) {
    console.warn("[login.otp] generateLink:", error?.message ?? "no email code");
    return noStore(NextResponse.json({ error: "send_failed" }, { status: 500 }));
  }

  const rendered = renderLoginOtpEmail({ code });
  const sendResult = await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: EMAIL_FROM_AUTH,
    bypassManagedReroute: true,
  });
  if (!sendResult.ok) {
    console.error("[login.otp] send failed:", sendResult.reason, sendResult.error);
    return noStore(NextResponse.json({ error: "send_failed" }, { status: 500 }));
  }

  return noStore(NextResponse.json({ ok: true }));
}
