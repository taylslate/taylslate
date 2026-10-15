// Show setup link. Sent when a show wants to answer an outreach and does
// not have an account yet. The link lands them in onboarding, then back
// on the pitch.

import { escapeHtml, emailParagraph, renderEmailLayout } from "@/lib/email/layout";

export interface MagicLinkEmailInput {
  to_email: string;
  brand_name: string;
  show_name: string;
  magic_link_url: string;
}

export interface RenderedMagicLinkEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderMagicLinkEmail(
  input: MagicLinkEmailInput,
): RenderedMagicLinkEmail {
  const subject = `Set up your Taylslate account to respond to ${input.brand_name}`;
  const sentence = `${input.brand_name} sent a sponsorship offer for ${input.show_name}. Set up your account to review the terms. This link expires in 24 hours and brings you back to the offer.`;
  const laid = renderEmailLayout({
    preheader: `${input.brand_name} sent an offer for ${input.show_name}.`,
    headline: `Respond to ${input.brand_name}`,
    bodyHtml: emailParagraph(escapeHtml(sentence)),
    cta: { href: input.magic_link_url, label: "Set up your account" },
    text: [sentence, "", input.magic_link_url].join("\n"),
  });
  return { subject, html: laid.html, text: laid.text };
}
