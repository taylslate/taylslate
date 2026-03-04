import { jsPDF } from "jspdf";
import type { Invoice } from "@/lib/data/types";

const MARGIN = 40;
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const NAVY = [15, 27, 45] as const;
const BLUE = [46, 125, 232] as const;
const GRAY = [90, 99, 112] as const;
const LIGHT_GRAY = [226, 229, 234] as const;
const TEXT = [26, 31, 39] as const;
const WHITE = [255, 255, 255] as const;
const SUCCESS = [22, 163, 74] as const;
const WARNING = [245, 158, 11] as const;

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function generateInvoicePdf(invoice: Invoice): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;

  function checkPage(needed: number) {
    if (y + needed > 752) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function drawLine(yPos: number) {
    doc.setDrawColor(...LIGHT_GRAY);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, yPos, PAGE_WIDTH - MARGIN, yPos);
  }

  // =========================================================
  // HEADER
  // =========================================================
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_WIDTH, 80, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...WHITE);
  doc.text("INVOICE", MARGIN, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 190, 210);
  doc.text(invoice.invoice_number, MARGIN, 54);

  // Status + date on right
  doc.setFontSize(9);
  const statusText = invoice.status.toUpperCase();
  const statusWidth = doc.getTextWidth(statusText);
  doc.text(statusText, PAGE_WIDTH - MARGIN - statusWidth, 36);

  const dateText = `Issued: ${fmtDate(invoice.created_at)}`;
  const dateWidth = doc.getTextWidth(dateText);
  doc.text(dateText, PAGE_WIDTH - MARGIN - dateWidth, 54);

  y = 100;

  // =========================================================
  // BILL TO / FROM
  // =========================================================
  const colWidth = CONTENT_WIDTH / 2 - 10;

  // From (publisher/agent)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLUE);
  doc.text("FROM", MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let fromY = y + 14;
  doc.setTextColor(...TEXT);
  doc.text(invoice.from_name, MARGIN, fromY);
  fromY += 12;
  doc.setTextColor(...GRAY);
  doc.text(invoice.from_email, MARGIN, fromY);
  fromY += 12;
  if (invoice.from_address) {
    const addrLines = doc.splitTextToSize(invoice.from_address, colWidth);
    doc.text(addrLines, MARGIN, fromY);
    fromY += addrLines.length * 12;
  }

  // Bill To
  const rightX = MARGIN + colWidth + 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLUE);
  doc.text("BILL TO", rightX, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let toY = y + 14;
  doc.setTextColor(...TEXT);
  doc.text(invoice.bill_to_name, rightX, toY);
  toY += 12;
  doc.setTextColor(...GRAY);
  doc.text(invoice.bill_to_email, rightX, toY);
  toY += 12;
  if (invoice.bill_to_address) {
    const addrLines = doc.splitTextToSize(invoice.bill_to_address, colWidth);
    doc.text(addrLines, rightX, toY);
    toY += addrLines.length * 12;
  }

  y = Math.max(fromY, toY) + 8;

  // =========================================================
  // REFERENCE INFO
  // =========================================================
  drawLine(y);
  y += 14;

  doc.setFillColor(247, 248, 250);
  doc.rect(MARGIN, y - 8, CONTENT_WIDTH, 44, "F");
  doc.setDrawColor(...LIGHT_GRAY);
  doc.rect(MARGIN, y - 8, CONTENT_WIDTH, 44, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const refCols = [
    { label: "IO Reference", value: invoice.io_number },
    { label: "Advertiser", value: invoice.advertiser_name },
    { label: "Campaign Period", value: invoice.campaign_period },
    { label: "Due Date", value: fmtDate(invoice.due_date) },
  ];

  const refColWidth = CONTENT_WIDTH / refCols.length;
  for (let i = 0; i < refCols.length; i++) {
    const rx = MARGIN + i * refColWidth + 12;
    doc.setTextColor(...GRAY);
    doc.text(refCols[i].label, rx, y + 4);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEXT);
    doc.text(refCols[i].value, rx, y + 18);
    doc.setFont("helvetica", "normal");
  }

  y += 52;

  // =========================================================
  // LINE ITEMS TABLE
  // =========================================================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("LINE ITEMS", MARGIN, y);
  y += 16;

  const cols = [
    { label: "#", width: 24 },
    { label: "Show", width: 110 },
    { label: "Post Date", width: 70 },
    { label: "Description", width: 130 },
    { label: "Guar. DLs", width: 55 },
    { label: "Actual DLs", width: 55 },
    { label: "Amount", width: 60 },
    { label: "Status", width: 50 },
  ];

  const totalColWidth = cols.reduce((s, c) => s + c.width, 0);
  const scale = CONTENT_WIDTH / totalColWidth;
  for (const col of cols) col.width *= scale;

  // Header row
  checkPage(30);
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN, y - 10, CONTENT_WIDTH, 16, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  let x = MARGIN + 4;
  for (const col of cols) {
    doc.text(col.label, x, y);
    x += col.width;
  }
  y += 14;

  // Data rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (let i = 0; i < invoice.line_items.length; i++) {
    checkPage(20);
    const li = invoice.line_items[i];
    const isEven = i % 2 === 0;

    if (isEven) {
      doc.setFillColor(247, 248, 250);
      doc.rect(MARGIN, y - 9, CONTENT_WIDTH, 14, "F");
    }

    // Determine make-good / delivery status
    const delivered = li.actual_downloads != null;
    const underdelivered =
      delivered &&
      li.actual_downloads! < li.guaranteed_downloads * 0.9;

    x = MARGIN + 4;
    const rowData = [
      String(i + 1),
      li.show_name.length > 20 ? li.show_name.slice(0, 18) + "..." : li.show_name,
      fmtDate(li.post_date),
      li.description.length > 28 ? li.description.slice(0, 26) + "..." : li.description,
      li.guaranteed_downloads.toLocaleString(),
      delivered ? li.actual_downloads!.toLocaleString() : "—",
      `$${fmt(li.rate)}`,
      li.make_good ? "Make-Good" : delivered ? "Delivered" : "Pending",
    ];

    for (let j = 0; j < cols.length; j++) {
      // Color the status column
      if (j === 7) {
        if (li.make_good) {
          doc.setTextColor(...WARNING);
        } else if (underdelivered) {
          doc.setTextColor(...WARNING);
        } else if (delivered) {
          doc.setTextColor(...SUCCESS);
        } else {
          doc.setTextColor(...GRAY);
        }
      } else {
        doc.setTextColor(...TEXT);
      }

      // Right-align numeric columns
      if (j >= 4 && j <= 6) {
        const tw = doc.getTextWidth(rowData[j]);
        doc.text(rowData[j], x + cols[j].width - tw - 4, y);
      } else {
        doc.text(rowData[j], x, y);
      }
      x += cols[j].width;
    }
    y += 14;
  }

  y += 10;

  // =========================================================
  // TOTALS
  // =========================================================
  checkPage(60);

  const totalsBlockWidth = CONTENT_WIDTH * 0.4;
  const totalsX = PAGE_WIDTH - MARGIN - totalsBlockWidth;

  // Subtotal
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text("Subtotal:", totalsX, y);
  doc.setTextColor(...TEXT);
  let tw = doc.getTextWidth(`$${fmt(invoice.subtotal)}`);
  doc.text(`$${fmt(invoice.subtotal)}`, PAGE_WIDTH - MARGIN - tw, y);
  y += 14;

  // Adjustments (make-goods)
  if (invoice.adjustments !== 0) {
    doc.setTextColor(...GRAY);
    doc.text("Adjustments:", totalsX, y);
    doc.setTextColor(...WARNING);
    const adjText = invoice.adjustments < 0 ? `-$${fmt(Math.abs(invoice.adjustments))}` : `$${fmt(invoice.adjustments)}`;
    tw = doc.getTextWidth(adjText);
    doc.text(adjText, PAGE_WIDTH - MARGIN - tw, y);
    y += 14;
  }

  // Total due
  drawLine(y - 4);
  y += 6;
  doc.setFillColor(...NAVY);
  doc.rect(totalsX - 8, y - 12, totalsBlockWidth + 8, 24, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(180, 190, 210);
  doc.text("Total Due:", totalsX, y + 2);
  doc.setTextColor(...WHITE);
  tw = doc.getTextWidth(`$${fmt(invoice.total_due)}`);
  doc.text(`$${fmt(invoice.total_due)}`, PAGE_WIDTH - MARGIN - tw, y + 2);

  y += 36;

  // =========================================================
  // PAYMENT TERMS
  // =========================================================
  checkPage(80);
  drawLine(y);
  y += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("PAYMENT INFORMATION", MARGIN, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const paymentInfo: [string, string][] = [
    ["Due Date", fmtDate(invoice.due_date)],
    ["Payment Method", invoice.payment_method ? invoice.payment_method.toUpperCase() : "ACH or Wire"],
    ["Pay To", invoice.from_name],
    ["Contact", invoice.from_email],
  ];

  for (const [label, value] of paymentInfo) {
    doc.setTextColor(...GRAY);
    doc.text(`${label}:`, MARGIN, y);
    doc.setTextColor(...TEXT);
    doc.text(value, MARGIN + 100, y);
    y += 14;
  }

  y += 10;

  // Notes
  if (invoice.notes) {
    checkPage(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...NAVY);
    doc.text("NOTES", MARGIN, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT);
    const noteLines = doc.splitTextToSize(invoice.notes, CONTENT_WIDTH);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * 11 + 8;
  }

  // Make-good notice
  const hasMakeGoods = invoice.line_items.some((li) => li.make_good);
  if (hasMakeGoods) {
    checkPage(40);
    doc.setFillColor(245, 158, 11, 15);
    doc.rect(MARGIN, y - 6, CONTENT_WIDTH, 30, "F");
    doc.setDrawColor(...WARNING);
    doc.setLineWidth(0.5);
    doc.rect(MARGIN, y - 6, CONTENT_WIDTH, 30, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...WARNING);
    doc.text("MAKE-GOOD NOTICE", MARGIN + 10, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...TEXT);
    doc.text(
      "One or more line items underdelivered by more than 10%. Make-good episodes will be scheduled at no additional cost.",
      MARGIN + 10,
      y + 18
    );
    y += 40;
  }

  // =========================================================
  // FOOTER
  // =========================================================
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(
      `${invoice.invoice_number}  |  Page ${i} of ${pageCount}  |  Generated by Taylslate`,
      MARGIN,
      782
    );
    doc.setDrawColor(...LIGHT_GRAY);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 772, PAGE_WIDTH - MARGIN, 772);
  }

  return Buffer.from(doc.output("arraybuffer"));
}
