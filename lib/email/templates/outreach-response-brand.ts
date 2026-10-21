// Notifies the brand when a show responds to their outreach.

import type { OutreachResponseStatus } from "@/lib/data/types";
import {
  emailColors,
  emailParagraph,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";

export interface BrandNotificationInput {
  brand_name: string;
  show_name: string;
  campaign_name: string;
  status: Extract<OutreachResponseStatus, "accepted" | "countered" | "declined">;

  /** Full URL back into the brand's dashboard. */
  campaign_url: string;
  outreach_url?: string;

  /** Original brand offer. */
  proposed_cpm: number;

  counter_cpm?: number | null;
  counter_message?: string | null;
  decline_reason?: string | null;
}

export interface RenderedBrandNotification {
  subject: string;
  html: string;
  text: string;
}

export function renderBrandNotification(
  input: BrandNotificationInput,
): RenderedBrandNotification {
  const linkUrl = input.outreach_url ?? input.campaign_url;
  const ctaLabel =
    input.status === "accepted"
      ? "Build the IO"
      : input.status === "countered"
        ? "Review the counter"
        : "Open the campaign";

  const headline =
    input.status === "accepted"
      ? `${input.show_name} accepted your offer`
      : input.status === "countered"
        ? `${input.show_name} sent a counter`
        : `${input.show_name} passed`;

  const subject =
    input.status === "accepted"
      ? `Accepted: ${input.show_name} (${input.campaign_name})`
      : input.status === "countered"
        ? `Counter from ${input.show_name}: $${(input.counter_cpm ?? 0).toFixed(2)} CPM`
        : `Declined: ${input.show_name}`;

  let detail = "";
  let textDetail = "";
  if (input.status === "accepted") {
    const rate = `$${input.proposed_cpm.toFixed(2)} CPM`;
    detail = emailParagraph(
      `Good news. They accepted your offer at <strong>${escapeHtml(rate)}</strong>. Build the insertion order when you are ready, and the dates lock in.`,
    );
    textDetail = `Good news. They accepted your offer at ${rate}. Build the insertion order when you are ready, and the dates lock in.`;
  } else if (input.status === "countered") {
    const counter = input.counter_cpm ?? 0;
    const delta = counter - input.proposed_cpm;
    const deltaLabel =
      delta > 0
        ? `$${delta.toFixed(2)} above your offer`
        : delta < 0
          ? `$${Math.abs(delta).toFixed(2)} below your offer`
          : "matches your offer";
    detail = emailParagraph(
      `They countered at <strong>$${counter.toFixed(2)} CPM</strong> (${escapeHtml(deltaLabel)}).`,
    );
    if (input.counter_message) {
      detail += `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid ${emailColors.accent};color:${emailColors.ink};font-size:13px;line-height:1.55;">${escapeHtml(input.counter_message)}</blockquote>`;
    }
    detail += emailParagraph(
      "You can accept the counter and move ahead, or send a new offer with different terms.",
    );
    textDetail = `They countered at $${counter.toFixed(2)} CPM (${deltaLabel}).${
      input.counter_message ? `\n\n"${input.counter_message}"` : ""
    }\n\nYou can accept the counter and move ahead, or send a new offer with different terms.`;
  } else {
    detail = emailParagraph(
      `${escapeHtml(input.show_name)} passed on this one${
        input.decline_reason
          ? `: ${escapeHtml(input.decline_reason)}`
          : "."
      } You can open the campaign and choose another show.`,
    );
    textDetail = `${input.show_name} passed${input.decline_reason ? `: ${input.decline_reason}` : "."} You can open the campaign and choose another show.`;
  }

  const eyebrow = `<p style="margin:0 0 8px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${emailColors.muted};">${escapeHtml(input.campaign_name)}</p>`;

  const laid = renderEmailLayout({
    preheader: headline,
    headline,
    bodyHtml: eyebrow + detail,
    cta: { href: linkUrl, label: ctaLabel },
    text: [headline, "", input.campaign_name, "", textDetail, "", `${ctaLabel}: ${linkUrl}`].join(
      "\n",
    ),
  });

  return { subject, html: laid.html, text: laid.text };
}
