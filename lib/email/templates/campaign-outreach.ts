// Legacy campaign-detail outreach. The brand writes the subject and body.
// This wraps that plain text in the shared layout. The send route calls
// resolveManagedDelivery before Resend, so a managed recipient is rerouted.

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
      emailParagraph(`A brand asked us to pass this along for ${escapeHtml(show)}.`) +
      (body ? plainParagraphs(body) : emailParagraph("The note did not include a message.")),
    note: "Sent through Taylslate. Reply if you have a question.",
    text: [
      `A brand asked us to pass this along for ${show}.`,
      "",
      body,
      "",
      "Sent through Taylslate. Reply if you have a question.",
    ].join("\n"),
  });
  return laid;
}
