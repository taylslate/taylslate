// Sent to the show when a deal is cancelled by the brand or by the 14-day timeout.

import { emailParagraph, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

export interface DealCancelledInput {
  brand_name: string;
  show_name: string;
  reason?: string | null;
  /** "timeout" is the 14-day close. "brand_cancelled" is a brand action. */
  cause: "brand_cancelled" | "timeout";
}

export interface RenderedDealCancelled {
  subject: string;
  html: string;
  text: string;
}

export function renderDealCancelledShow(
  input: DealCancelledInput,
): RenderedDealCancelled {
  const timeout = input.cause === "timeout";
  const subject = timeout
    ? "This opportunity has closed"
    : `${input.brand_name} cancelled the deal`;
  const headline = timeout
    ? `The ${input.brand_name} opportunity has closed`
    : `${input.brand_name} cancelled the deal`;
  const reason = input.reason?.trim();
  const body = timeout
    ? `More than 14 days passed without a signed insertion order, so the deal for ${input.show_name} is closed. ${input.brand_name} can reach out again later. Your show stays available.`
    : `${input.brand_name} cancelled the deal for ${input.show_name} before it was fully signed.${
        reason ? ` Reason: ${reason}` : ""
      } Your show stays available.`;

  const laid = renderEmailLayout({
    preheader: headline,
    headline,
    bodyHtml: emailParagraph(escapeHtml(body)),
    text: body,
  });
  return { subject, html: laid.html, text: laid.text };
}
