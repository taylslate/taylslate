// One email when a brand payment is held for an unverified show owner.
// No amount and no ids. The show name is escaped.

import { EMAIL_SITE_URL, emailParagraph, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

export const PAYOUT_HELD_SUBJECT = "Verify your show to get paid";
export const PAYOUT_HELD_URL = `${EMAIL_SITE_URL}/settings/ownership`;

export function renderPayoutHeldEmail(input: { showName: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const name = input.showName.trim() || "your show";
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(PAYOUT_HELD_URL);
  const bodyHtml = emailParagraph(
    `A brand payment for ${safeName} is waiting. Verify you own the show at <a href="${safeUrl}">${safeUrl}</a> and it will be sent.`
  );
  const text = `A brand payment for ${name} is waiting. Verify you own the show at ${PAYOUT_HELD_URL} and it will be sent.`;
  const layout = renderEmailLayout({
    preheader: PAYOUT_HELD_SUBJECT,
    bodyHtml,
    text,
  });
  return { subject: PAYOUT_HELD_SUBJECT, html: layout.html, text: layout.text };
}
