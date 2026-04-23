// Wave 12 IO PDF generator — driven entirely by a Wave12 Deal + its related
// brand_profile / show_profile / outreach. VeritoneOne-style layout. No agency
// involvement: Taylslate is the bill-to entity in the pay-as-delivers model.
//
// Deterministic: same inputs → same PDF. No timestamps embedded other than the
// dates already in the deal.

import { jsPDF } from "jspdf";
import type {
  Wave12Deal,
  BrandProfile,
  ShowProfile,
  Outreach,
  ShowEpisodeCadence,
  ShowAdReadType,
} from "@/lib/data/types";

// ---- Visual constants (mirror lib/pdf/io-pdf.ts) ----

const MARGIN = 40;
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NAVY = [15, 27, 45] as const;
const BLUE = [46, 125, 232] as const;
const GRAY = [90, 99, 112] as const;
const LIGHT_GRAY = [226, 229, 234] as const;
const TEXT = [26, 31, 39] as const;
const WHITE = [255, 255, 255] as const;

// ---- Helpers ----

function money(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function placementLabel(p: string): string {
  return p === "pre-roll"
    ? "Pre-roll"
    : p === "mid-roll"
      ? "Mid-roll"
      : p === "post-roll"
        ? "Post-roll"
        : p;
}

function brandDisplayName(bp: BrandProfile): string {
  if (bp.brand_identity) {
    return bp.brand_identity.split(/[.,—–-]/)[0]?.trim() || bp.brand_identity;
  }
  if (bp.brand_website) {
    return bp.brand_website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
  return "Advertiser";
}

const CADENCE_DAYS: Record<ShowEpisodeCadence, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  irregular: 7, // best-effort default for irregular cadence
};

/**
 * Derive evenly spaced post dates across the agreed flight window using the
 * show's stated cadence. Falls back to evenly distributing if the math
 * doesn't fit. Returns ISO date strings.
 */
export function derivePostDates(
  startIso: string,
  endIso: string,
  episodeCount: number,
  cadence: ShowEpisodeCadence | null | undefined
): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || episodeCount <= 0) {
    return [];
  }
  const flightDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const cadenceDays = cadence ? CADENCE_DAYS[cadence] : 7;

  // If cadence × episodes fits in the flight, use cadence spacing. Otherwise
  // distribute evenly so the last episode lands on or before flight_end.
  const wantedSpan = cadenceDays * (episodeCount - 1);
  const spacing =
    wantedSpan <= flightDays
      ? cadenceDays
      : Math.max(1, Math.floor(flightDays / Math.max(1, episodeCount - 1)));

  const dates: string[] = [];
  for (let i = 0; i < episodeCount; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * spacing);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function readerTypeLabel(types: ShowAdReadType[] | undefined): string {
  if (!types || types.length === 0) return "Host-read";
  if (types.includes("scripted")) return "Scripted";
  if (types.includes("personal_experience")) return "Host-read (personal)";
  if (types.includes("talking_points")) return "Host-read (talking points)";
  return "Host-read";
}

export interface IoPdfInput {
  deal: Wave12Deal;
  brandProfile: BrandProfile;
  showProfile: ShowProfile;
  outreach: Outreach;
  /** Email for the brand owner (from auth.users / profiles). */
  brandSigningEmail: string;
  /** Email for the show owner (from auth.users / profiles). */
  showSigningEmail: string;
  /** Optional Taylslate IO number for display. */
  ioNumber?: string;
}

export interface RenderedIo {
  pdfBuffer: Buffer;
  ioNumber: string;
  totalGross: number;
  totalNet: number;
  totalDownloads: number;
  postDates: string[];
}

// ---- Main generator ----

export function generateIoPdfFromDeal(input: IoPdfInput): RenderedIo {
  const { deal, brandProfile, showProfile, outreach } = input;
  const ioNumber = input.ioNumber ?? `IO-${deal.id.slice(0, 8).toUpperCase()}`;
  const advertiserName = brandDisplayName(brandProfile);
  const publisherName = showProfile.show_name ?? outreach.show_name ?? "Publisher";
  const audience = showProfile.audience_size ?? 0;
  const cpm = deal.agreed_cpm;
  const grossPerEp = (audience / 1000) * cpm;
  const totalGross = grossPerEp * deal.agreed_episode_count;
  const totalNet = totalGross; // Taylslate absorbs fees in its 8% platform fee
  const totalDownloads = audience * deal.agreed_episode_count;

  const postDates = derivePostDates(
    deal.agreed_flight_start,
    deal.agreed_flight_end,
    deal.agreed_episode_count,
    showProfile.episode_cadence
  );

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;

  function checkPage(needed: number): void {
    if (y + needed > 752) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function drawLine(yPos: number): void {
    doc.setDrawColor(...LIGHT_GRAY);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, yPos, PAGE_WIDTH - MARGIN, yPos);
  }

  // ---- Header ----
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_WIDTH, 80, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...WHITE);
  doc.text("INSERTION ORDER", MARGIN, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 190, 210);
  doc.text(ioNumber, MARGIN, 54);

  const dateText = `Issued: ${fmtDate(deal.created_at)}`;
  let tw = doc.getTextWidth(dateText);
  doc.text(dateText, PAGE_WIDTH - MARGIN - tw, 36);
  const flightText = `Flight: ${fmtDate(deal.agreed_flight_start)} – ${fmtDate(deal.agreed_flight_end)}`;
  tw = doc.getTextWidth(flightText);
  doc.text(flightText, PAGE_WIDTH - MARGIN - tw, 54);

  y = 100;

  // ---- Parties ----
  function drawPartyBlock(
    title: string,
    fields: [string, string][],
    startX: number,
    width: number
  ): number {
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
      const labelWidth = 78;
      const lines = doc.splitTextToSize(value, width - labelWidth);
      doc.text(lines, startX + labelWidth, localY);
      localY += lines.length * 12;
    }
    return localY;
  }

  const colWidth = CONTENT_WIDTH / 2 - 10;

  const advFields: [string, string][] = [
    ["Company", advertiserName],
    ["Brand URL", brandProfile.brand_website ?? ""],
    ["Media Contact", input.brandSigningEmail],
    ["Billing Contact", input.brandSigningEmail], // brand profile has no separate billing field yet
  ];
  const pubFields: [string, string][] = [
    ["Show", publisherName],
    ["Activation Contact", showProfile.ad_copy_email ?? input.showSigningEmail],
    ["Billing Contact", showProfile.billing_email ?? input.showSigningEmail],
  ];

  const advBottom = drawPartyBlock("Advertiser", advFields, MARGIN, colWidth);
  const pubBottom = drawPartyBlock("Publisher", pubFields, MARGIN + colWidth + 20, colWidth);
  y = Math.max(advBottom, pubBottom) + 10;

  drawLine(y);
  y += 14;

  // Bill-To: Taylslate is the billing entity for pay-as-delivers
  const billToFields: [string, string][] = [
    ["Company", "Taylslate"],
    ["Role", "Billing entity (pay-as-delivers)"],
    ["Invoices to", "billing@taylslate.com"],
  ];
  const billBottom = drawPartyBlock("Bill To / Agency", billToFields, MARGIN, CONTENT_WIDTH);
  y = billBottom + 10;

  drawLine(y);
  y += 20;

  // ---- Line items table ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("LINE ITEMS", MARGIN, y);
  y += 16;

  const cols = [
    { label: "#", width: 24 },
    { label: "Show", width: 120 },
    { label: "Post Date", width: 75 },
    { label: "Placement", width: 70 },
    { label: "DLs Guar.", width: 60 },
    { label: "CPM", width: 50 },
    { label: "Gross", width: 60 },
    { label: "Net Due", width: 60 },
  ];
  const totalColWidth = cols.reduce((s, c) => s + c.width, 0);
  const scale = CONTENT_WIDTH / totalColWidth;
  for (const col of cols) col.width *= scale;

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

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (let i = 0; i < deal.agreed_episode_count; i++) {
    checkPage(20);
    const isEven = i % 2 === 0;
    if (isEven) {
      doc.setFillColor(247, 248, 250);
      doc.rect(MARGIN, y - 9, CONTENT_WIDTH, 14, "F");
    }
    doc.setTextColor(...TEXT);
    x = MARGIN + 4;
    const rowData = [
      String(i + 1),
      publisherName.length > 22 ? publisherName.slice(0, 20) + "..." : publisherName,
      postDates[i] ? fmtDate(postDates[i]) : "TBD",
      placementLabel(deal.agreed_placement),
      audience.toLocaleString(),
      `$${money(cpm)}`,
      `$${money(grossPerEp)}`,
      `$${money(grossPerEp)}`,
    ];
    for (let j = 0; j < cols.length; j++) {
      if (j >= 4) {
        const w = doc.getTextWidth(rowData[j]);
        doc.text(rowData[j], x + cols[j].width - w - 4, y);
      } else {
        doc.text(rowData[j], x, y);
      }
      x += cols[j].width;
    }
    y += 14;
  }

  // ---- Per-episode delivery details ----
  y += 6;
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  const formatLabel =
    showProfile.ad_formats?.includes("dynamic_insertion") &&
    !showProfile.ad_formats.includes("host_read_baked")
      ? "Dynamic insertion"
      : "Host-read baked-in";
  const detailsLine = [
    showProfile.platform === "youtube" ? "YouTube" : "Podcast",
    formatLabel,
    readerTypeLabel(showProfile.ad_read_types),
    "Evergreen",
    "No pixel required",
  ].join("  |  ");
  doc.text(detailsLine, MARGIN + 4, y);
  y += 14;

  // ---- Totals ----
  checkPage(50);
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN + CONTENT_WIDTH * 0.5, y - 8, CONTENT_WIDTH * 0.5, 50, "F");

  const totalsX = MARGIN + CONTENT_WIDTH * 0.55;
  const totalsValX = PAGE_WIDTH - MARGIN - 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(180, 190, 210);
  doc.text("Total Downloads:", totalsX, y + 2);
  doc.setTextColor(...WHITE);
  let tw2 = doc.getTextWidth(totalDownloads.toLocaleString());
  doc.text(totalDownloads.toLocaleString(), totalsValX - tw2, y + 2);

  doc.setTextColor(180, 190, 210);
  doc.text("Total Gross:", totalsX, y + 16);
  doc.setTextColor(...WHITE);
  tw2 = doc.getTextWidth(`$${money(totalGross)}`);
  doc.text(`$${money(totalGross)}`, totalsValX - tw2, y + 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(180, 190, 210);
  doc.text("Total Net Due:", totalsX, y + 32);
  doc.setTextColor(...WHITE);
  tw2 = doc.getTextWidth(`$${money(totalNet)}`);
  doc.text(`$${money(totalNet)}`, totalsValX - tw2, y + 32);

  y += 64;

  // ---- Terms & conditions ----
  checkPage(180);
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
    ["Payment", "Pay-as-delivers via Taylslate. Each verified episode triggers a charge against the brand's card on file. Show payouts follow each charge."],
    ["Exclusivity", "90 days competitor exclusivity from first air date in the brand's stated category."],
    ["ROFR", "30-day right of first refusal on renewed placements at the same CPM."],
    ["Cancellation", "14 business days written notice required prior to next scheduled post date."],
    ["Download Tracking", "45-day tracking window from original post date for verification and make-good calculation."],
    ["Make-Good", "If actual downloads fall more than 10% below the guaranteed downloads above, publisher will provide a make-good episode at no additional cost."],
  ];
  for (const [label, value] of terms) {
    checkPage(36);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT);
    const valLines = doc.splitTextToSize(value, CONTENT_WIDTH - 110);
    doc.text(valLines, MARGIN + 110, y);
    y += valLines.length * 11 + 6;
  }

  // ---- Standard legal clauses ----
  y += 10;
  checkPage(120);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text("STANDARD TERMS", MARGIN, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);

  const standardClauses = [
    "FTC Compliance: All sponsored content must comply with FTC endorsement guidelines. Host must clearly and conspicuously disclose the material connection with the advertiser within the ad read.",
    "Editorial Control: Publisher retains editorial control over ad delivery. Publisher may decline ads that conflict with their editorial standards or audience expectations.",
    "Morality / Take-Down: Either party may terminate this IO if the other party engages in conduct that brings them into public disrepute.",
    "Intellectual Property: Advertiser grants publisher a limited, non-exclusive license to use brand name, trademarks, and talking points solely for the ad reads specified.",
    "Indemnification: Each party indemnifies the other against claims arising from their respective obligations under this IO.",
  ];
  for (const clause of standardClauses) {
    checkPage(40);
    const lines = doc.splitTextToSize(clause, CONTENT_WIDTH);
    doc.text(lines, MARGIN, y);
    y += lines.length * 9 + 6;
  }

  // ---- Signatures ----
  checkPage(140);
  y += 10;
  drawLine(y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("SIGNATURES", MARGIN, y);
  y += 20;

  const sigColWidth = CONTENT_WIDTH / 2 - 10;

  function drawSignatureBlock(
    label: string,
    signedAt: string | null | undefined,
    signedBy: string,
    startX: number
  ): void {
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

    if (signedAt) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(11);
      doc.setTextColor(...TEXT);
      doc.text(signedBy, startX + 4, sigY - 6);
    }

    const dateLineY = sigY + 30;
    doc.line(startX, dateLineY, startX + sigColWidth - 20, dateLineY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text("Date", startX, dateLineY + 10);
    if (signedAt) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TEXT);
      doc.text(fmtDate(signedAt), startX + 4, dateLineY - 6);
    }
  }

  drawSignatureBlock(
    "Advertiser",
    deal.brand_signed_at,
    advertiserName,
    MARGIN
  );
  drawSignatureBlock(
    "Publisher",
    deal.show_signed_at,
    publisherName,
    MARGIN + sigColWidth + 20
  );

  // ---- Footer ----
  const lastPage = doc.getNumberOfPages();
  for (let p = 1; p <= lastPage; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(
      `Generated by Taylslate · ${ioNumber} · Page ${p} of ${lastPage}`,
      MARGIN,
      772
    );
    if (deal.docusign_envelope_id) {
      const envText = `DocuSign Envelope ID: ${deal.docusign_envelope_id}`;
      const w = doc.getTextWidth(envText);
      doc.text(envText, PAGE_WIDTH - MARGIN - w, 772);
    }
  }

  // jsPDF returns ArrayBuffer; coerce to Node Buffer for Supabase storage.
  const arrayBuffer = doc.output("arraybuffer");
  return {
    pdfBuffer: Buffer.from(arrayBuffer),
    ioNumber,
    totalGross,
    totalNet,
    totalDownloads,
    postDates,
  };
}
