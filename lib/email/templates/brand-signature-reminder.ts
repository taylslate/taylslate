// Day-3 reminder from the deal-timeout cron. One send per deal.

import { emailParagraph, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

export interface BrandReminderInput {
  brand_name: string;
  show_name: string;
  agreed_cpm: number;
  agreed_episode_count: number;
  deal_url: string;
  days_waiting: number;
}

export interface RenderedBrandReminder {
  subject: string;
  html: string;
  text: string;
}

export function renderBrandSignatureReminder(
  input: BrandReminderInput,
): RenderedBrandReminder {
  const subject = `Reminder: sign the IO for ${input.show_name}`;
  const episodes = `${input.agreed_episode_count} episode${input.agreed_episode_count === 1 ? "" : "s"}`;
  const sentence = `${input.show_name} accepted ${input.days_waiting} days ago, and the insertion order is still unsigned. The terms are $${input.agreed_cpm.toFixed(2)} CPM for ${episodes}. Sign it and we will send it to the show. If it is still unsigned after 14 days, the deal closes.`;
  const laid = renderEmailLayout({
    preheader: `The IO for ${input.show_name} is still unsigned.`,
    headline: `The IO for ${input.show_name} is unsigned`,
    bodyHtml: emailParagraph(escapeHtml(sentence)),
    cta: { href: input.deal_url, label: "Sign the IO" },
    text: [sentence, "", `Sign the IO: ${input.deal_url}`].join("\n"),
  });
  return { subject, html: laid.html, text: laid.text };
}
