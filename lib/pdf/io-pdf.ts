import { jsPDF } from "jspdf";
import type { InsertionOrder } from "@/lib/data/types";

// VeritoneOne-style IO PDF generator
// Professional document layout: header, parties, line items table, terms, signature blocks

const MARGIN = 40;
const PAGE_WIDTH = 612; // letter
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Colors
const NAVY = [15, 27, 45] as const; // brand navy
const BLUE = [46, 125, 232] as const; // brand blue
const GRAY = [90, 99, 112] as const;
const LIGHT_GRAY = [226, 229, 234] as const;
const TEXT = [26, 31, 39] as const;
const WHITE = [255, 255, 255] as const;

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

function capitalize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generateIOPdf(io: InsertionOrder): Buffer {
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
  doc.text("INSERTION ORDER", MARGIN, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 190, 210);
  doc.text(io.io_number, MARGIN, 54);

  // Date on right
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 190, 210);
  const dateText = `Issued: ${fmtDate(io.created_at)}`;
  const dateWidth = doc.getTextWidth(dateText);
  doc.text(dateText, PAGE_WIDTH - MARGIN - dateWidth, 36);

  if (io.status) {
    const statusText = `Status: ${capitalize(io.status)}`;
    const statusWidth = doc.getTextWidth(statusText);
    doc.text(statusText, PAGE_WIDTH - MARGIN - statusWidth, 54);
  }

  y = 100;

  // =========================================================
  // PARTIES SECTION
  // =========================================================
  function drawPartyBlock(title: string, fields: [string, string][], startX: number, width: number) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...BLUE);
    doc.text(title.toUpperCase(), startX, y);

    let localY = y + 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const [label, value] of fields) {
      if (!value || value === "—") continue;
      doc.setTextColor(...GRAY);
      doc.text(label + ":", startX, localY);
      doc.setTextColor(...TEXT);
      // Wrap long values
      const labelWidth = 70;
      const lines = doc.splitTextToSize(value, width - labelWidth);
      doc.text(lines, startX + labelWidth, localY);
      localY += lines.length * 12;
    }
    return localY;
  }

  const colWidth = CONTENT_WIDTH / 2 - 10;

  // Advertiser + Publisher side by side
  const advFields: [string, string][] = [
    ["Company", io.advertiser_name],
    ["Contact", io.advertiser_contact_name ?? ""],
    ["Email", io.advertiser_contact_email ?? ""],
  ];
  const pubFields: [string, string][] = [
    ["Company", io.publisher_name],
    ["Contact", io.publisher_contact_name],
    ["Email", io.publisher_contact_email],
    ["Address", io.publisher_address ?? ""],
  ];

  const advBottom = drawPartyBlock("Advertiser", advFields, MARGIN, colWidth);
  const pubBottom = drawPartyBlock("Publisher", pubFields, MARGIN + colWidth + 20, colWidth);
  y = Math.max(advBottom, pubBottom) + 8;

  // Agency (if applicable)
  if (io.agency_name) {
    drawLine(y);
    y += 14;
    const agencyFields: [string, string][] = [
      ["Company", io.agency_name],
      ["Contact", io.agency_contact_name ?? ""],
      ["Email", io.agency_contact_email ?? ""],
      ["Billing", io.agency_billing_contact ?? ""],
      ["Address", io.agency_address ?? ""],
      ["Invoices To", io.send_invoices_to ?? ""],
    ];
    const agencyBottom = drawPartyBlock("Agency", agencyFields, MARGIN, CONTENT_WIDTH);
    y = agencyBottom + 8;
  }

  drawLine(y);
  y += 20;

  // =========================================================
  // LINE ITEMS TABLE
  // =========================================================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("LINE ITEMS", MARGIN, y);
  y += 16;

  // Table header
  const cols = [
    { label: "#", width: 20 },
    { label: "Show", width: 100 },
    { label: "Post Date", width: 65 },
    { label: "Placement", width: 55 },
    { label: "DLs", width: 50 },
    { label: "Type", width: 40 },
    { label: "CPM", width: 40 },
    { label: "Gross", width: 55 },
    { label: "Net Due", width: 55 },
  ];

  // Adjust widths to fit
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
  for (let i = 0; i < io.line_items.length; i++) {
    checkPage(20);
    const li = io.line_items[i];
    const isEven = i % 2 === 0;

    if (isEven) {
      doc.setFillColor(247, 248, 250);
      doc.rect(MARGIN, y - 9, CONTENT_WIDTH, 14, "F");
    }

    doc.setTextColor(...TEXT);
    x = MARGIN + 4;
    const rowData = [
      String(i + 1),
      li.show_name.length > 18 ? li.show_name.slice(0, 16) + "..." : li.show_name,
      fmtDate(li.post_date),
      capitalize(li.placement),
      li.guaranteed_downloads.toLocaleString(),
      li.price_type === "cpm" ? "CPM" : "Flat",
      `$${fmt(li.gross_cpm)}`,
      `$${fmt(li.gross_rate)}`,
      `$${fmt(li.net_due)}`,
    ];

    for (let j = 0; j < cols.length; j++) {
      // Right-align numeric columns
      if (j >= 4) {
        const tw = doc.getTextWidth(rowData[j]);
        doc.text(rowData[j], x + cols[j].width - tw - 4, y);
      } else {
        doc.text(rowData[j], x, y);
      }
      x += cols[j].width;
    }
    y += 14;
  }

  // Content details subtitle row per line item
  y += 4;
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  for (const li of io.line_items) {
    checkPage(12);
    const details = [
      li.format === "youtube" ? "YouTube" : "Podcast",
      capitalize(li.reader_type),
      li.is_scripted ? "Scripted" : "Organic",
      li.is_personal_experience ? "Personal Exp." : "Standard",
      capitalize(li.content_type),
      li.pixel_required ? "Pixel Required" : "",
    ]
      .filter(Boolean)
      .join("  |  ");
    doc.text(`${li.show_name}: ${details}`, MARGIN + 4, y);
    y += 10;
  }

  y += 6;

  // Totals
  checkPage(40);
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN + CONTENT_WIDTH * 0.5, y - 8, CONTENT_WIDTH * 0.5, 36, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(180, 190, 210);
  const totalsX = MARGIN + CONTENT_WIDTH * 0.55;
  const totalsValX = PAGE_WIDTH - MARGIN - 8;

  doc.text("Total Downloads:", totalsX, y + 2);
  doc.setTextColor(...WHITE);
  let tw = doc.getTextWidth(io.total_downloads.toLocaleString());
  doc.text(io.total_downloads.toLocaleString(), totalsValX - tw, y + 2);

  doc.setTextColor(180, 190, 210);
  doc.text("Total Gross:", totalsX, y + 14);
  doc.setTextColor(...WHITE);
  tw = doc.getTextWidth(`$${fmt(io.total_gross)}`);
  doc.text(`$${fmt(io.total_gross)}`, totalsValX - tw, y + 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(180, 190, 210);
  doc.text("Total Net Due:", totalsX, y + 26);
  doc.setTextColor(...WHITE);
  tw = doc.getTextWidth(`$${fmt(io.total_net)}`);
  doc.text(`$${fmt(io.total_net)}`, totalsValX - tw, y + 26);

  y += 52;

  // =========================================================
  // TERMS & CONDITIONS
  // =========================================================
  checkPage(200);
  drawLine(y);
  y += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("TERMS & CONDITIONS", MARGIN, y);
  y += 18;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT);

  const terms: [string, string][] = [
    ["Payment", io.payment_terms],
    ["Exclusivity", `${io.exclusivity_days} days competitor exclusivity from first air date`],
    ["ROFR", `${io.rofr_days}-day right of first refusal on renewed placements`],
    ["Cancellation", `${io.cancellation_notice_days} business days written notice required`],
    ["Download Tracking", `${io.download_tracking_days}-day tracking window from original post date`],
    [
      "Make-Good",
      `If actual downloads fall more than ${(io.make_good_threshold * 100).toFixed(0)}% below guaranteed downloads, publisher will provide a make-good episode at no additional cost`,
    ],
  ];

  for (const [label, value] of terms) {
    checkPage(30);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT);
    const valLines = doc.splitTextToSize(value, CONTENT_WIDTH - 100);
    doc.text(valLines, MARGIN + 100, y);
    y += valLines.length * 11 + 6;
  }

  // Competitor exclusion list
  if (io.competitor_exclusion.length > 0) {
    checkPage(30);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Excluded:", MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT);
    const excText = io.competitor_exclusion.join(", ");
    const excLines = doc.splitTextToSize(excText, CONTENT_WIDTH - 100);
    doc.text(excLines, MARGIN + 100, y);
    y += excLines.length * 11 + 6;
  }

  // Standard legal clauses
  y += 8;
  checkPage(90);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text("STANDARD TERMS", MARGIN, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);

  const standardClauses = [
    "FTC Compliance: All sponsored content must comply with FTC endorsement guidelines. Host must clearly disclose the material connection with the advertiser. Disclosure must be clear, conspicuous, and made within the ad read.",
    "Content Standards: Publisher/host retains editorial control over ad delivery. All ad reads must accurately represent the advertiser's product/service. Publisher reserves the right to decline any advertisement that conflicts with their editorial standards or audience expectations.",
    "Morality / Take-Down: Either party may terminate this IO if the other party engages in conduct that brings them into public disrepute. Content may be removed if deemed harmful or in violation of platform terms of service.",
    "Intellectual Property: Advertiser grants publisher a limited, non-exclusive license to use brand name, trademarks, and talking points solely for the purpose of delivering the ad reads specified in this IO.",
    "Indemnification: Each party agrees to indemnify the other against claims arising from their respective obligations under this IO, including but not limited to content accuracy, FTC compliance, and payment obligations.",
  ];

  for (const clause of standardClauses) {
    checkPage(35);
    const lines = doc.splitTextToSize(clause, CONTENT_WIDTH);
    doc.text(lines, MARGIN, y);
    y += lines.length * 9 + 6;
  }

  // =========================================================
  // SIGNATURE BLOCKS
  // =========================================================
  checkPage(120);
  y += 10;
  drawLine(y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("SIGNATURES", MARGIN, y);
  y += 20;

  const sigColWidth = CONTENT_WIDTH / 2 - 10;

  function drawSignatureBlock(label: string, name: string | undefined, startX: number) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...BLUE);
    doc.text(label.toUpperCase(), startX, y);

    const sigY = y + 30;
    doc.setDrawColor(...LIGHT_GRAY);
    doc.setLineWidth(0.5);
    doc.line(startX, sigY, startX + sigColWidth - 20, sigY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text("Signature", startX, sigY + 10);

    // If signed, show the name
    if (name) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(12);
      doc.setTextColor(...TEXT);
      doc.text(name, startX + 4, sigY - 8);
    }

    // Date line
    const dateLineY = sigY + 30;
    doc.line(startX, dateLineY, startX + sigColWidth - 20, dateLineY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text("Date", startX, dateLineY + 10);

    if (io.signed_at) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TEXT);
      doc.text(fmtDate(io.signed_at), startX + 4, dateLineY - 6);
    }

    // Print name line
    const nameLineY = dateLineY + 30;
    doc.line(startX, nameLineY, startX + sigColWidth - 20, nameLineY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text("Print Name & Title", startX, nameLineY + 10);
  }

  // Publisher signature on left
  drawSignatureBlock(
    "Publisher / Talent Representative",
    io.signed_by_publisher,
    MARGIN
  );

  // Agency or Advertiser on right
  if (io.agency_name) {
    drawSignatureBlock(
      "Agency",
      io.signed_by_agency,
      MARGIN + sigColWidth + 20
    );
  } else {
    drawSignatureBlock(
      "Advertiser",
      undefined,
      MARGIN + sigColWidth + 20
    );
  }

  y += 100;

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
      `${io.io_number}  |  Page ${i} of ${pageCount}  |  Generated by Taylslate`,
      MARGIN,
      782
    );
    // Thin line above footer
    doc.setDrawColor(...LIGHT_GRAY);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 772, PAGE_WIDTH - MARGIN, 772);
  }

  // Return as Buffer
  return Buffer.from(doc.output("arraybuffer"));
}
