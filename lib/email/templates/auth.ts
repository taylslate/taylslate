// Supabase Auth email templates. These are stored in the hosted project's
// auth config (Management API), not sent through Resend.
//
// Confirm signup, magic link, recovery, and invite use a token_hash link
// to /callback so verifyOtp runs on the server. ConfirmationURL puts the
// session in a URL fragment a server route cannot read.
// Email change keeps ConfirmationURL: secure email change uses a different
// verify type on the current address and the new address.

import {
  emailColors,
  emailParagraph,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";
import {
  LOGIN_OTP_PREHEADER,
  LOGIN_OTP_SENTENCE,
  LOGIN_OTP_SUBJECT,
  otpCodeHtml,
} from "@/lib/email/templates/login-otp";

export interface AuthEmailTemplate {
  id: string;
  subjectKey: string;
  contentKey: string;
  subject: string;
  html: string;
  text: string;
}

function callbackHref(type: string, nextPath: string): string {
  return `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=${type}&next=${nextPath}`;
}

function linkFallback(href: string): string {
  const safe = escapeHtml(href);
  return `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${emailColors.muted};">If the button does not work, open this link:<br><a href="${safe}" style="color:${emailColors.accent};word-break:break-all;">${safe}</a></p>`;
}

function authMessage(input: {
  id: string;
  subjectKey: string;
  contentKey: string;
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  href?: string;
  cta?: string;
  /** Extra Go-template HTML inserted after the paragraph. Not escaped. */
  extraHtml?: string;
  text: string;
}): AuthEmailTemplate {
  const laid = renderEmailLayout({
    preheader: input.preheader,
    headline: input.headline,
    bodyHtml:
      emailParagraph(input.body) +
      (input.extraHtml ?? "") +
      (input.href ? linkFallback(input.href) : ""),
    cta: input.href && input.cta ? { href: input.href, label: input.cta } : undefined,
    text: input.href ? `${input.text}\n\n${input.href}` : input.text,
  });
  return {
    id: input.id,
    subjectKey: input.subjectKey,
    contentKey: input.contentKey,
    subject: input.subject,
    html: laid.html,
    text: laid.text,
  };
}

export function renderAuthTemplates(): AuthEmailTemplate[] {
  const confirmHref = callbackHref("signup", "/onboarding");
  const magicHref = callbackHref("magiclink", "/dashboard");
  const recoveryHref = callbackHref("recovery", "/reset-password");
  const inviteHref = callbackHref("invite", "/onboarding");
  const emailChangeHref = "{{ .ConfirmationURL }}";

  return [
    authMessage({
      id: "confirm-signup",
      subjectKey: "mailer_subjects_confirmation",
      contentKey: "mailer_templates_confirmation_content",
      subject: "Confirm your Taylslate account",
      preheader: "Confirm your email to finish signing up.",
      headline: "Confirm your email",
      body: "Welcome. Confirm this address to finish creating your Taylslate account. The link expires in 24 hours.",
      href: confirmHref,
      cta: "Confirm email",
      text: "Welcome. Confirm this address to finish creating your Taylslate account. The link expires in 24 hours.",
    }),
    authMessage({
      id: "magic-link",
      subjectKey: "mailer_subjects_magic_link",
      contentKey: "mailer_templates_magic_link_content",
      subject: "Log in to Taylslate",
      preheader: "Here is your sign-in link. It expires in 24 hours.",
      headline: "Log in",
      body: "Here is your sign-in link. It expires in 24 hours.",
      href: magicHref,
      cta: "Log in",
      text: "Here is your sign-in link. It expires in 24 hours.",
    }),
    // Supabase has no separate OTP config field. Email OTP shares the
    // magic-link slot. This template is the code email brands and shows
    // receive from Resend. The apply script checks it and does not
    // overwrite the magic-link slot with it.
    authMessage({
      id: "otp",
      subjectKey: "mailer_subjects_otp",
      contentKey: "mailer_templates_otp_content",
      subject: LOGIN_OTP_SUBJECT,
      preheader: LOGIN_OTP_PREHEADER,
      headline: "Your sign-in code",
      body: LOGIN_OTP_SENTENCE,
      extraHtml: otpCodeHtml("{{ .Token }}"),
      text: `${LOGIN_OTP_SENTENCE}\n\n{{ .Token }}`,
    }),
    authMessage({
      id: "recovery",
      subjectKey: "mailer_subjects_recovery",
      contentKey: "mailer_templates_recovery_content",
      subject: "Reset your Taylslate password",
      preheader: "Choose a new password for your Taylslate account.",
      headline: "Reset your password",
      body: "Choose a new password for your Taylslate account. This link expires in 24 hours. If you did not ask for a reset, you can ignore this email.",
      href: recoveryHref,
      cta: "Reset password",
      text: "Choose a new password for your Taylslate account. This link expires in 24 hours. If you did not ask for a reset, you can ignore this email.",
    }),
    authMessage({
      id: "invite",
      subjectKey: "mailer_subjects_invite",
      contentKey: "mailer_templates_invite_content",
      subject: "You are invited to Taylslate",
      preheader: "Accept the invite to create your account.",
      headline: "You are invited",
      body: "You are invited to create a Taylslate account. Accept the invite when you are ready.",
      href: inviteHref,
      cta: "Accept invite",
      text: "You are invited to create a Taylslate account. Accept the invite when you are ready.",
    }),
    authMessage({
      id: "email-change",
      subjectKey: "mailer_subjects_email_change",
      contentKey: "mailer_templates_email_change_content",
      subject: "Confirm your new Taylslate email",
      preheader: "Confirm the new email on your Taylslate account.",
      headline: "Confirm your new email",
      body: "Confirm {{ .NewEmail }} as the email on your Taylslate account. If you did not ask for this change, you can ignore this email.",
      href: emailChangeHref,
      cta: "Confirm new email",
      text: "Confirm {{ .NewEmail }} as the email on your Taylslate account. If you did not ask for this change, you can ignore this email.",
    }),
    authMessage({
      id: "reauthentication",
      subjectKey: "mailer_subjects_reauthentication",
      contentKey: "mailer_templates_reauthentication_content",
      subject: "Your Taylslate verification code",
      preheader: "Enter this code to confirm it is you.",
      headline: "Your verification code",
      body: "Enter this code to confirm it is you. It expires shortly.",
      extraHtml: `<p style="margin:8px 0 0;font-size:28px;letter-spacing:0.18em;font-weight:600;color:${emailColors.ink};">{{ .Token }}</p>`,
      text: "Enter this code to confirm it is you. It expires shortly.\n\n{{ .Token }}",
    }),
    authMessage({
      id: "password-changed",
      subjectKey: "mailer_subjects_password_changed_notification",
      contentKey: "mailer_templates_password_changed_notification_content",
      subject: "Your Taylslate password was changed",
      preheader: "The password on your Taylslate account was changed.",
      headline: "Your password was changed",
      body: "The password on your Taylslate account was just changed. If you did not do this, reset your password and contact Taylslate.",
      text: "The password on your Taylslate account was just changed. If you did not do this, reset your password and contact Taylslate.",
    }),
    authMessage({
      id: "email-changed",
      subjectKey: "mailer_subjects_email_changed_notification",
      contentKey: "mailer_templates_email_changed_notification_content",
      subject: "Your Taylslate email was changed",
      preheader: "The email on your Taylslate account was changed.",
      headline: "Your email was changed",
      body: "The email on your Taylslate account changed from {{ .OldEmail }} to {{ .Email }}. If you did not do this, contact Taylslate.",
      text: "The email on your Taylslate account changed from {{ .OldEmail }} to {{ .Email }}. If you did not do this, contact Taylslate.",
    }),
    authMessage({
      id: "phone-changed",
      subjectKey: "mailer_subjects_phone_changed_notification",
      contentKey: "mailer_templates_phone_changed_notification_content",
      subject: "Your Taylslate phone number was changed",
      preheader: "The phone number on your Taylslate account was changed.",
      headline: "Your phone number was changed",
      body: "The phone number on your Taylslate account changed from {{ .OldPhone }} to {{ .Phone }}. If you did not do this, contact Taylslate.",
      text: "The phone number on your Taylslate account changed from {{ .OldPhone }} to {{ .Phone }}. If you did not do this, contact Taylslate.",
    }),
    authMessage({
      id: "mfa-enrolled",
      subjectKey: "mailer_subjects_mfa_factor_enrolled_notification",
      contentKey: "mailer_templates_mfa_factor_enrolled_notification_content",
      subject: "A verification method was added to your Taylslate account",
      preheader: "A new verification method was added.",
      headline: "A verification method was added",
      body: "A {{ .FactorType }} verification method was added to your Taylslate account. If you did not do this, contact Taylslate.",
      text: "A {{ .FactorType }} verification method was added to your Taylslate account. If you did not do this, contact Taylslate.",
    }),
    authMessage({
      id: "mfa-unenrolled",
      subjectKey: "mailer_subjects_mfa_factor_unenrolled_notification",
      contentKey: "mailer_templates_mfa_factor_unenrolled_notification_content",
      subject: "A verification method was removed from your Taylslate account",
      preheader: "A verification method was removed.",
      headline: "A verification method was removed",
      body: "A {{ .FactorType }} verification method was removed from your Taylslate account. If you did not do this, contact Taylslate.",
      text: "A {{ .FactorType }} verification method was removed from your Taylslate account. If you did not do this, contact Taylslate.",
    }),
    authMessage({
      id: "identity-linked",
      subjectKey: "mailer_subjects_identity_linked_notification",
      contentKey: "mailer_templates_identity_linked_notification_content",
      subject: "A sign-in method was linked to your Taylslate account",
      preheader: "A sign-in method was linked.",
      headline: "A sign-in method was linked",
      body: "Your {{ .Provider }} account was linked as a sign-in method for {{ .Email }}. If you did not do this, contact Taylslate.",
      text: "Your {{ .Provider }} account was linked as a sign-in method for {{ .Email }}. If you did not do this, contact Taylslate.",
    }),
    authMessage({
      id: "identity-unlinked",
      subjectKey: "mailer_subjects_identity_unlinked_notification",
      contentKey: "mailer_templates_identity_unlinked_notification_content",
      subject: "A sign-in method was removed from your Taylslate account",
      preheader: "A sign-in method was removed.",
      headline: "A sign-in method was removed",
      body: "Your {{ .Provider }} account was removed as a sign-in method for {{ .Email }}. If you did not do this, contact Taylslate.",
      text: "Your {{ .Provider }} account was removed as a sign-in method for {{ .Email }}. If you did not do this, contact Taylslate.",
    }),
  ];
}

/**
 * Keys the Management API actually stores. `mailer_subjects_otp` is not one
 * of them — Supabase sends email OTP through the magic-link template. The
 * OTP template stays in this module for the apply script and previews, and
 * is left out of the patch so a live apply cannot 400 on an unknown field
 * or replace the magic link.
 */
const HOSTED_AUTH_TEMPLATE_KEYS = new Set([
  "mailer_subjects_confirmation",
  "mailer_subjects_magic_link",
  "mailer_subjects_recovery",
  "mailer_subjects_invite",
  "mailer_subjects_email_change",
  "mailer_subjects_reauthentication",
  "mailer_subjects_password_changed_notification",
  "mailer_subjects_email_changed_notification",
  "mailer_subjects_phone_changed_notification",
  "mailer_subjects_mfa_factor_enrolled_notification",
  "mailer_subjects_mfa_factor_unenrolled_notification",
  "mailer_subjects_identity_linked_notification",
  "mailer_subjects_identity_unlinked_notification",
]);

/** Subject and HTML fields for PATCH /v1/projects/{ref}/config/auth. Does not touch enabled flags. */
export function authTemplateConfigPatch(): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const template of renderAuthTemplates()) {
    if (!HOSTED_AUTH_TEMPLATE_KEYS.has(template.subjectKey)) continue;
    patch[template.subjectKey] = template.subject;
    patch[template.contentKey] = template.html;
  }
  return patch;
}

/** Local check the apply script runs before it touches the hosted project. */
export function assertShowOtpTemplate(): void {
  const otp = renderAuthTemplates().find((template) => template.id === "otp");
  if (!otp) throw new Error("OTP auth template is missing");
  if (otp.subject !== LOGIN_OTP_SUBJECT) {
    throw new Error("OTP auth template subject drifted");
  }
  if (!otp.html.includes("{{ .Token }}")) {
    throw new Error("OTP auth template has no {{ .Token }}");
  }
  if (!otp.html.includes('data-taylslate-email="1"') || !otp.html.includes("#ffffff")) {
    throw new Error("OTP auth template is not on the shared layout");
  }
  if (otp.html.includes("#f2ebe1")) {
    throw new Error("OTP auth template is still on the paper field");
  }
  if (otp.html.includes(".ConfirmationURL") || otp.html.includes("token_hash=")) {
    throw new Error("OTP auth template must be a code, not a link");
  }
  const patch = authTemplateConfigPatch();
  if ("mailer_subjects_otp" in patch || "mailer_templates_otp_content" in patch) {
    throw new Error("OTP template must not be sent as an unknown auth config key");
  }
  const magic = patch.mailer_templates_magic_link_content ?? "";
  if (!magic.includes("type=magiclink") || !magic.includes("next=/dashboard")) {
    throw new Error("refusing to apply auth templates without the magic link");
  }
}
