// Sent to the brand when a show accepts, or when the brand accepts a counter.
// The insertion order is ready to review and sign.

import { emailParagraph, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

export interface IoReadyInput {
  brand_name: string;
  show_name: string;
  agreed_cpm: number;
  agreed_episode_count: number;
  deal_url: string;
}

export interface RenderedIoReady {
  subject: string;
  html: string;
  text: string;
}

function episodes(count: number): string {
  return `${count} episode${count === 1 ? "" : "s"}`;
}

export function renderIoReadyForSignature(input: IoReadyInput): RenderedIoReady {
  const subject = `${input.show_name} accepted — the IO is ready to sign`;
  const terms = `$${input.agreed_cpm.toFixed(2)} CPM for ${episodes(input.agreed_episode_count)}`;
  const sentence = `${input.show_name} accepted your offer at ${terms}. Review the insertion order and sign it. After you sign, we send it to ${input.show_name} to countersign on DocuSign.`;
  const laid = renderEmailLayout({
    preheader: `The IO for ${input.show_name} is ready to sign.`,
    headline: `${input.show_name} accepted your offer`,
    bodyHtml: emailParagraph(escapeHtml(sentence)),
    cta: { href: input.deal_url, label: "Review and sign" },
    text: [sentence, "", `Review and sign: ${input.deal_url}`].join("\n"),
  });
  return { subject, html: laid.html, text: laid.text };
}
