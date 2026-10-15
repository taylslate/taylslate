// Invoice email with the PDF attached. The route owns the subject and the send.

import type { Invoice } from "@/lib/data/types";
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

export function renderInvoiceNotice(invoice: Invoice, senderName: string): {
  html: string;
  text: string;
} {
  const greeting = invoice.bill_to_name?.trim()
    ? `Hi ${invoice.bill_to_name.trim()},`
    : "Hi,";
  const due = formatDateOnly(invoice.due_date);
  const intro = `Please find the attached invoice for ${invoice.advertiser_name} — ${invoice.campaign_period}. Payment is due by ${due}.`;

  const rows: Array<[string, string]> = [
    ["Invoice", escapeHtml(invoice.invoice_number)],
    ["IO", escapeHtml(invoice.io_number)],
    ["Line items", String(invoice.line_items.length)],
    ["Subtotal", escapeHtml(`$${money(invoice.subtotal)}`)],
  ];
  if (invoice.adjustments !== 0) {
    rows.push(["Adjustments", escapeHtml(`-$${money(Math.abs(invoice.adjustments))}`)]);
  }
  rows.push(
    ["Total due", escapeHtml(`$${money(invoice.total_due)}`)],
    ["Due", escapeHtml(due)],
  );

  const lineRows = invoice.line_items.map((item, index) => [
    String(index + 1),
    escapeHtml(item.show_name),
    escapeHtml(formatDateOnly(item.post_date)),
    escapeHtml(item.description),
    escapeHtml(`$${money(item.rate)}`),
  ]);

  const laid = renderEmailLayout({
    preheader: `Invoice ${invoice.invoice_number} from ${senderName}.`,
    headline: `Invoice ${invoice.invoice_number}`,
    bodyHtml:
      emailParagraph(escapeHtml(greeting)) +
      emailParagraph(escapeHtml(intro)) +
      emailDetailTable(rows) +
      (lineRows.length
        ? emailDataTable(["#", "Show", "Date", "Description", "Amount"], lineRows)
        : "") +
      emailParagraph(`The PDF is attached.<br>${escapeHtml(senderName)}`),
    text: [
      greeting,
      "",
      intro,
      "",
      `Invoice: ${invoice.invoice_number}`,
      `IO: ${invoice.io_number}`,
      `Total due: $${money(invoice.total_due)}`,
      `Due: ${due}`,
      "",
      senderName,
    ].join("\n"),
  });
  return laid;
}
