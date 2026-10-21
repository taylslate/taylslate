// Login magic-link email. Sent when someone asks for a sign-in link from
// /login, and again when an admin hands a managed brand to its owner.
// One subject, one sentence, one button. Outreach show-setup mail is a
// different template.

import { emailParagraph, renderEmailLayout } from "@/lib/email/layout";

export interface LoginMagicEmailInput {
  login_url: string;
}

export interface RenderedLoginMagicEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderLoginMagicEmail(
  input: LoginMagicEmailInput,
): RenderedLoginMagicEmail {
  const subject = "Log in to Taylslate";
  const sentence = "Here is your sign-in link. It expires in 24 hours.";
  const laid = renderEmailLayout({
    preheader: sentence,
    bodyHtml: emailParagraph(sentence),
    cta: { href: input.login_url, label: "Log in" },
    text: [sentence, "", input.login_url].join("\n"),
  });
  return { subject, html: laid.html, text: laid.text };
}
