// Shared IO term text for both PDF generators.
//
// Defaults reproduce the document each generator already prints.
// payment_off_platform, a named agency, a disabled term, a flat line,
// or a per-line format are the only reasons the wording changes.
// Cancellation is the one standing copy change: calendar days.

import type { InsertionOrder, IOLineItem, PriceType } from "@/lib/data/types";
import type { IoLineItemDraft } from "@/lib/pdf/io-generator";

export const ON_PLATFORM_PAYMENT =
  "Pay-as-delivers via Taylslate. Each verified episode charges the brand the rate on this IO plus the platform fee on top. The show is paid the full rate on this IO.";

export type IoPayer = "brand" | "agency";

export interface IoTermSource {
  payment_terms?: string | null;
  payment_off_platform?: boolean | null;
  exclusivity_days?: number | null;
  rofr_days?: number | null;
  rofr_enabled?: boolean | null;
  cancellation_notice_days?: number | null;
  download_tracking_days?: number | null;
  download_tracking_enabled?: boolean | null;
  make_good_threshold?: number | null;
  make_good_enabled?: boolean | null;
  agency_name?: string | null;
  agency_contact_name?: string | null;
  agency_contact_email?: string | null;
  payer?: string | null;
}

export interface IoPdfSaved extends IoTermSource {
  lineItems?: IoLineItemDraft[];
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isFlatRate(priceType: string | null | undefined): boolean {
  return priceType === "flat_rate";
}

export function flatPerSpotLabel(amount: number): string {
  const formatted = num(amount, 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Flat, $${formatted} per spot`;
}

export function visibleDownloadTotal(
  lines: Array<{ price_type?: string | null; guaranteed_downloads?: number | null }>
): number {
  return lines.reduce((sum, line) => {
    if (isFlatRate(line.price_type)) return sum;
    return sum + (Number(line.guaranteed_downloads) || 0);
  }, 0);
}

export function payerLabel(payer: string | null | undefined): string {
  return payer === "agency" ? "Agency of record" : "Advertiser";
}

export function agencyContactLine(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  return [name, email]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

/** Deal-flow payment sentence. Off-platform prints the free text and nothing else. */
export function dealPaymentClause(source: IoTermSource): string {
  if (source.payment_off_platform) return (source.payment_terms ?? "").trim();
  return ON_PLATFORM_PAYMENT;
}

/** Legacy editor payment sentence. Off-platform still prints only the free text. */
export function storedPaymentClause(source: IoTermSource): string {
  if (source.payment_off_platform) return (source.payment_terms ?? "").trim();
  const stored = (source.payment_terms ?? "").trim();
  return stored || "Net 30 EOM";
}

export function dealTermRows(source: IoTermSource = {}): [string, string][] {
  const rows: [string, string][] = [];
  const payment = dealPaymentClause(source);
  if (payment) rows.push(["Payment", payment]);
  rows.push([
    "Exclusivity",
    `${num(source.exclusivity_days, 90)} days competitor exclusivity from first air date in the brand's stated category.`,
  ]);
  if (source.rofr_enabled !== false) {
    rows.push([
      "ROFR",
      `${num(source.rofr_days, 30)}-day right of first refusal on renewed placements at the same CPM.`,
    ]);
  }
  rows.push([
    "Cancellation",
    `${num(source.cancellation_notice_days, 14)} calendar days written notice required prior to next scheduled post date.`,
  ]);
  if (source.download_tracking_enabled !== false) {
    rows.push([
      "Download Tracking",
      `${num(source.download_tracking_days, 45)}-day tracking window from original post date for verification and make-good calculation.`,
    ]);
  }
  if (source.make_good_enabled !== false) {
    const pct = (num(source.make_good_threshold, 0.1) * 100).toFixed(0);
    rows.push([
      "Make-Good",
      `If actual downloads fall more than ${pct}% below the guaranteed downloads above, publisher will provide a make-good episode at no additional cost.`,
    ]);
  }
  return rows;
}

export function storedTermRows(source: IoTermSource): [string, string][] {
  const rows: [string, string][] = [];
  const payment = storedPaymentClause(source);
  if (payment) rows.push(["Payment", payment]);
  rows.push([
    "Exclusivity",
    `${num(source.exclusivity_days, 90)} days competitor exclusivity from first air date`,
  ]);
  if (source.rofr_enabled !== false) {
    rows.push([
      "ROFR",
      `${num(source.rofr_days, 30)}-day right of first refusal on renewed placements`,
    ]);
  }
  rows.push([
    "Cancellation",
    `${num(source.cancellation_notice_days, 14)} calendar days written notice required`,
  ]);
  if (source.download_tracking_enabled !== false) {
    rows.push([
      "Download Tracking",
      `${num(source.download_tracking_days, 45)}-day tracking window from original post date`,
    ]);
  }
  if (source.make_good_enabled !== false) {
    const pct = (num(source.make_good_threshold, 0.1) * 100).toFixed(0);
    rows.push([
      "Make-Good",
      `If actual downloads fall more than ${pct}% below guaranteed downloads, publisher will provide a make-good episode at no additional cost`,
    ]);
  }
  return rows;
}

function lineDraft(item: IOLineItem): IoLineItemDraft {
  const priceType: PriceType = item.price_type === "flat_rate" ? "flat_rate" : "cpm";
  return {
    format: item.format === "youtube" ? "youtube" : "podcast",
    post_date: item.post_date ?? null,
    guaranteed_downloads: Number(item.guaranteed_downloads) || 0,
    show_name: item.show_name,
    placement: item.placement,
    is_scripted: item.is_scripted === true,
    is_personal_experience: item.is_personal_experience === true,
    reader_type: item.reader_type,
    content_type: item.content_type,
    pixel_required: item.pixel_required === true,
    gross_rate: Number(item.gross_rate) || 0,
    gross_cpm: Number(item.gross_cpm) || 0,
    price_type: priceType,
    net_due: Number(item.net_due) || 0,
    verified: item.verified === true,
    make_good_triggered: item.make_good_triggered === true,
    spot_format: item.spot_format?.trim() || null,
    ...(item.show_surface_id ? { show_surface_id: item.show_surface_id } : {}),
  };
}

/** Saved insertion order → the override the deal-flow PDF understands. */
export function ioToSaved(io: InsertionOrder): IoPdfSaved {
  const lines = io.line_items ?? [];
  return {
    payment_terms: io.payment_terms,
    payment_off_platform: io.payment_off_platform === true,
    exclusivity_days: num(io.exclusivity_days, 90),
    rofr_days: num(io.rofr_days, 30),
    rofr_enabled: io.rofr_enabled !== false,
    cancellation_notice_days: num(io.cancellation_notice_days, 14),
    download_tracking_days: num(io.download_tracking_days, 45),
    download_tracking_enabled: io.download_tracking_enabled !== false,
    make_good_threshold: num(io.make_good_threshold, 0.1),
    make_good_enabled: io.make_good_enabled !== false,
    agency_name: io.agency_name?.trim() || null,
    agency_contact_name: io.agency_contact_name ?? null,
    agency_contact_email: io.agency_contact_email ?? null,
    payer: io.payer === "agency" ? "agency" : "brand",
    lineItems: lines.length > 0 ? lines.map(lineDraft) : undefined,
  };
}
