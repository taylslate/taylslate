// Brand-forward outreach pitch. The brand name is the From display name.
// The send domain stays @taylslate.com so SPF/DKIM stay on our domain.

import type { Outreach } from "@/lib/data/types";
import { EMAIL_ADDRESS_OUTREACH } from "@/lib/email/addresses";
import {
  emailColors,
  emailDetailTable,
  emailParagraph,
  escapeHtml,
  plainParagraphs,
  renderEmailLayout,
} from "@/lib/email/layout";
import { formatDateOnly } from "@/lib/format/date-only";

export interface OutreachEmailInput {
  /** Recipient — the show. */
  show_name: string;
  to_email: string;

  /** Sender — the brand. */
  brand_name: string;
  brand_url?: string | null;

  /** The drafted, brand-edited pitch body (plain text). */
  pitch_body: string;

  /** Proposed terms, displayed verbatim in the body. */
  proposed_cpm: number;
  proposed_episode_count: number;
  proposed_placement: Outreach["proposed_placement"];
  proposed_flight_start: string;
  proposed_flight_end: string;

  /** Public pitch URL the show clicks to respond. */
  pitch_url: string;
}

export interface RenderedOutreachEmail {
  subject: string;
  html: string;
  text: string;
  from: string;
  reply_to: string;
}

const MAX_BRAND_NAME_LENGTH = 60;

function normalizeBrandName(raw: string | null | undefined): string {
  const firstLine = (raw ?? "").split(/\r?\n/)[0] ?? "";
  const cleaned = firstLine
    .replace(/[<>"\\]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Sponsorship";
  if (cleaned.length <= MAX_BRAND_NAME_LENGTH) return cleaned;

  const capped = cleaned.slice(0, MAX_BRAND_NAME_LENGTH);
  const lastSpace = capped.lastIndexOf(" ");
  const truncated = (lastSpace > 0 ? capped.slice(0, lastSpace) : capped).trim();
  return truncated || "Sponsorship";
}

function placementLabel(placement: string): string {
  if (placement === "pre-roll") return "Pre-roll";
  if (placement === "mid-roll") return "Mid-roll";
  if (placement === "post-roll") return "Post-roll";
  return placement;
}

function buildFromAndReply(brandName: string): { from: string; reply_to: string } {
  const safeName = brandName.replace(/[<>"\\]/g, "").trim() || "Sponsorship";
  return {
    from: `${safeName} <${EMAIL_ADDRESS_OUTREACH}>`,
    reply_to: EMAIL_ADDRESS_OUTREACH,
  };
}

export function renderOutreachEmail(input: OutreachEmailInput): RenderedOutreachEmail {
  const brandName = normalizeBrandName(input.brand_name);
  const subject = `A sponsorship offer from ${brandName} for ${input.show_name}`;
  const { from, reply_to } = buildFromAndReply(brandName);
  const placement = placementLabel(input.proposed_placement);
  const episodes = `${input.proposed_episode_count} ${input.proposed_episode_count === 1 ? "episode" : "episodes"}`;
  const flight = `${formatDateOnly(input.proposed_flight_start)} to ${formatDateOnly(input.proposed_flight_end)}`;
  const cpm = `$${input.proposed_cpm.toFixed(2)}`;

  const fromBlock = `<div style="font-size:12px;color:${emailColors.muted};letter-spacing:0.04em;text-transform:uppercase;margin:0 0 4px;">From</div><div style="font-size:16px;font-weight:600;color:${emailColors.ink};">${escapeHtml(brandName)}</div>${
    input.brand_url
      ? `<div style="font-size:12px;color:${emailColors.muted};margin:2px 0 0;">${escapeHtml(input.brand_url)}</div>`
      : ""
  }<div style="height:16px;line-height:16px;">&nbsp;</div>`;

  const terms = emailDetailTable([
    ["Proposed CPM", escapeHtml(cpm)],
    ["Episodes", escapeHtml(episodes)],
    ["Placement", escapeHtml(placement)],
    ["Flight", escapeHtml(flight)],
  ]);

  const laid = renderEmailLayout({
    preheader: `${brandName} sent a sponsorship offer for ${input.show_name}.`,
    bodyHtml:
      fromBlock +
      plainParagraphs(input.pitch_body) +
      `<p style="margin:8px 0 4px;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:${emailColors.muted};">Proposed terms</p>` +
      terms,
    cta: { href: input.pitch_url, label: "Review the offer" },
    note: "Reply to this email if you would like to talk it through first.",
    text: [
      input.pitch_body.trim(),
      "",
      "Proposed terms",
      `Proposed CPM: ${cpm}`,
      `Episodes: ${input.proposed_episode_count}`,
      `Placement: ${placement}`,
      `Flight: ${flight}`,
      "",
      `Review the offer: ${input.pitch_url}`,
      "",
      "Reply to this email if you would like to talk it through first.",
      "",
      `Sent for ${input.show_name} on behalf of ${brandName}.`,
    ].join("\n"),
  });

  return { subject, html: laid.html, text: laid.text, from, reply_to };
}
