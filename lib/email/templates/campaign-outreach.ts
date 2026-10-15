// Legacy campaign-detail outreach. The brand writes the subject and body.
// This wraps that plain text in the shared layout. It does not go through
// sendEmail, so managed-account reroute does not apply.

import {
  emailParagraph,
  escapeHtml,
  plainParagraphs,
  renderEmailLayout,
} from "@/lib/email/layout";

export function renderCampaignOutreachEmail(input: {
  showName: string;
  body: string;
}): { html: string; text: string } {
  const show = input.showName?.trim() || "the show";
  const body = input.body.trim();
  const laid = renderEmailLayout({
    preheader: `A sponsorship note for ${show}.`,
    headline: "Sponsorship offer",
    bodyHtml:
      emailParagraph(`To ${escapeHtml(show)}`) +
      (body ? plainParagraphs(body) : emailParagraph("The note is empty.")),
    note: "Sent by Taylslate.",
    text: [`To ${show}`, "", body, "", "Sent by Taylslate."].join("\n"),
  });
  return laid;
}
