// Show / creator sign-in code. Sent from POST /api/auth/login/otp.
// One subject, one sentence, the 6-digit code. The magic-link email stays
// a separate message.

import { emailColors, emailParagraph, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

export const LOGIN_OTP_SUBJECT = "Your Taylslate sign-in code";
export const LOGIN_OTP_PREHEADER = "Enter this code to sign in. It expires in 1 hour.";
export const LOGIN_OTP_SENTENCE =
  "Enter this code to sign in. It expires in 1 hour. If you did not ask for it, you can ignore this email.";

export interface LoginOtpEmailInput {
  /** Six digits, or the Go template `{{ .Token }}` for the hosted auth copy. */
  code: string;
}

export interface RenderedLoginOtpEmail {
  subject: string;
  html: string;
  text: string;
}

export function otpCodeHtml(code: string): string {
  return `<p style="margin:8px 0 0;font-size:28px;letter-spacing:0.18em;font-weight:600;color:${emailColors.ink};">${escapeHtml(code)}</p>`;
}

export function renderLoginOtpEmail(input: LoginOtpEmailInput): RenderedLoginOtpEmail {
  const laid = renderEmailLayout({
    preheader: LOGIN_OTP_PREHEADER,
    headline: "Your sign-in code",
    bodyHtml: emailParagraph(LOGIN_OTP_SENTENCE) + otpCodeHtml(input.code),
    text: [LOGIN_OTP_SENTENCE, "", input.code].join("\n"),
  });
  return { subject: LOGIN_OTP_SUBJECT, html: laid.html, text: laid.text };
}
