// Legacy insertion-order email. The PDF is attached. Signing for Wave 12
// deals goes through DocuSign; this message is the PDF copy from the IO page.

import type { InsertionOrder } from "@/lib/data/types";
import {
  emailDataTable,
  emailDetailTable,
  emailParagraph,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";
import { formatDateOnly } from "@/lib/format/date-only";

function money(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function placementLabel(placement: string): string {
  if (placement === "pre-roll") return "Pre-roll";
  if (placement === "mid-roll") return "Mid-roll";
  if (placement === "post-roll") return "Post-roll";
  return placement;
}

export function renderIoAttachmentEmail(
  io: InsertionOrder,
  senderName: string,
): { html: string; text: string } {
  const recipientName = io.agency_name
    ? io.agency_contact_name
    : io.advertiser_contact_name;
  const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : "Hi,";
  const showName = io.line_items[0]?.show_name ?? "your campaign";
  const intro = `Please find the attached insertion order for ${showName} on behalf of ${io.advertiser_name}.`;

  const lineRows = io.line_items.map((item, index) => [
    String(index + 1),
    escapeHtml(item.show_name),
    escapeHtml(formatDateOnly(item.post_date)),
    escapeHtml(placementLabel(item.placement)),
    escapeHtml(item.guaranteed_downloads.toLocaleString("en-US")),
    escapeHtml(`$${money(item.net_due)}`),
  ]);

  const laid = renderEmailLayout({
    preheader: `Insertion order ${io.io_number} from ${senderName}.`,
    headline: `Insertion order ${io.io_number}`,
    bodyHtml:
      emailParagraph(escapeHtml(greeting)) +
      emailParagraph(escapeHtml(intro)) +
      emailDetailTable([
        ["Advertiser", escapeHtml(io.advertiser_name)],
        ["Episodes", String(io.line_items.length)],
        ["Total net", escapeHtml(`$${money(io.total_net)}`)],
        ["Payment terms", escapeHtml(io.payment_terms)],
      ]) +
      (lineRows.length
        ? emailDataTable(
            ["#", "Show", "Date", "Placement", "Downloads", "Net"],
            lineRows,
          )
        : "") +
      emailParagraph(
        `The full insertion order, with terms, is attached as a PDF. Reply if anything needs to change.<br>${escapeHtml(senderName)}`,
      ),
    text: [
      greeting,
      "",
      intro,
      "",
      `Advertiser: ${io.advertiser_name}`,
      `Episodes: ${io.line_items.length}`,
      `Total net: $${money(io.total_net)}`,
      `Payment terms: ${io.payment_terms}`,
      "",
      "The full insertion order is attached as a PDF.",
      "",
      senderName,
    ].join("\n"),
  });
  return laid;
}
