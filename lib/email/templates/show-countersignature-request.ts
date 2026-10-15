// Heads-up to the show after the brand signs. DocuSign sends the
// countersignature request in a separate email.

import {
  emailDetailTable,
  emailParagraph,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";

export interface ShowCountersignInput {
  brand_name: string;
  show_name: string;
  agreed_cpm: number;
  agreed_episode_count: number;
}

export interface RenderedShowCountersign {
  subject: string;
  html: string;
  text: string;
}

export function renderShowCountersignatureRequest(
  input: ShowCountersignInput,
): RenderedShowCountersign {
  const subject = `${input.brand_name} signed — your IO is on the way`;
  const episodes = `${input.agreed_episode_count} episode${input.agreed_episode_count === 1 ? "" : "s"}`;
  const cpm = `$${input.agreed_cpm.toFixed(2)}`;
  const sentence = `${input.brand_name} signed the insertion order for ${input.show_name}. DocuSign will email you a separate link to countersign. That message comes from dse@docusign.net. After you sign, the deal is set.`;
  const laid = renderEmailLayout({
    preheader: `${input.brand_name} signed. DocuSign will send the countersign link.`,
    headline: `${input.brand_name} signed the IO`,
    bodyHtml:
      emailParagraph(escapeHtml(sentence)) +
      emailDetailTable([
        ["CPM", escapeHtml(cpm)],
        ["Episodes", escapeHtml(episodes)],
      ]),
    note: "The DocuSign email comes from dse@docusign.net.",
    text: [
      sentence,
      "",
      `Agreed terms: ${cpm} CPM × ${input.agreed_episode_count} episodes.`,
      "",
      "The DocuSign email comes from dse@docusign.net.",
    ].join("\n"),
  });
  return { subject, html: laid.html, text: laid.text };
}
