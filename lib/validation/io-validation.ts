import type { InsertionOrder, IOLineItem, Placement, PriceType } from "@/lib/data";

// --- IO Number Generation ---

export function generateIONumber(): string {
  const year = new Date().getFullYear();
  // Increment from existing seed data (IO-2026-0001, IO-2026-0002 exist)
  const next = Math.floor(Math.random() * 9000) + 1000;
  return `IO-${year}-${String(next).padStart(4, "0")}`;
}

// --- Line Item Normalization ---

const VALID_PLACEMENTS: Placement[] = ["pre-roll", "mid-roll", "post-roll"];
const VALID_PRICE_TYPES: PriceType[] = ["cpm", "flat_rate"];
const VALID_READER_TYPES = ["host_read", "producer_read", "guest_read"] as const;
const VALID_CONTENT_TYPES = ["evergreen", "dated"] as const;
const VALID_FORMATS = ["podcast", "youtube"] as const;

export function normalizeLineItem(raw: Record<string, unknown>, index: number): IOLineItem {
  const guaranteedDownloads = Math.max(0, Number(raw.guaranteed_downloads) || 0);
  const grossRate = Math.max(0, Number(raw.gross_rate) || 0);
  const netDue = Math.max(0, Number(raw.net_due) || grossRate);

  // Calculate CPM if not provided
  let grossCpm = Number(raw.gross_cpm) || 0;
  if (!grossCpm && guaranteedDownloads > 0 && grossRate > 0) {
    grossCpm = Math.round((grossRate / guaranteedDownloads) * 1000 * 100) / 100;
  }

  const placement = VALID_PLACEMENTS.includes(raw.placement as Placement)
    ? (raw.placement as Placement)
    : "mid-roll";

  const priceType = VALID_PRICE_TYPES.includes(raw.price_type as PriceType)
    ? (raw.price_type as PriceType)
    : "cpm";

  const readerType = (VALID_READER_TYPES as readonly string[]).includes(raw.reader_type as string)
    ? (raw.reader_type as IOLineItem["reader_type"])
    : "host_read";

  const contentType = (VALID_CONTENT_TYPES as readonly string[]).includes(raw.content_type as string)
    ? (raw.content_type as IOLineItem["content_type"])
    : "evergreen";

  const format = (VALID_FORMATS as readonly string[]).includes(raw.format as string)
    ? (raw.format as IOLineItem["format"])
    : "podcast";

  return {
    id: `line-import-${index + 1}`,
    format,
    post_date: typeof raw.post_date === "string" && raw.post_date ? raw.post_date : "",
    guaranteed_downloads: guaranteedDownloads,
    show_name: typeof raw.show_name === "string" ? raw.show_name : "",
    placement,
    is_scripted: raw.is_scripted === true,
    is_personal_experience: raw.is_personal_experience !== false, // default true
    reader_type: readerType,
    content_type: contentType,
    pixel_required: raw.pixel_required === true,
    gross_rate: grossRate,
    gross_cpm: grossCpm,
    price_type: priceType,
    net_due: netDue,
    verified: false,
    make_good_triggered: false,
  };
}

// --- Totals Calculation ---

export function calculateIOTotals(lineItems: IOLineItem[]): {
  total_downloads: number;
  total_gross: number;
  total_net: number;
} {
  return {
    total_downloads: lineItems.reduce((sum, li) => sum + li.guaranteed_downloads, 0),
    total_gross: lineItems.reduce((sum, li) => sum + li.gross_rate, 0),
    total_net: lineItems.reduce((sum, li) => sum + li.net_due, 0),
  };
}

// --- Validation ---

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateIOData(data: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Required string fields
  if (!data.advertiser_name || typeof data.advertiser_name !== "string") {
    errors.push("Advertiser name is required");
  }
  if (!data.publisher_name || typeof data.publisher_name !== "string") {
    errors.push("Publisher name is required");
  }
  if (!data.publisher_contact_name || typeof data.publisher_contact_name !== "string") {
    errors.push("Publisher contact name is required");
  }
  if (!data.publisher_contact_email || typeof data.publisher_contact_email !== "string") {
    errors.push("Publisher contact email is required");
  }

  // Line items
  if (!Array.isArray(data.line_items) || data.line_items.length === 0) {
    errors.push("At least one line item is required");
  } else {
    for (let i = 0; i < data.line_items.length; i++) {
      const li = data.line_items[i] as Record<string, unknown>;
      if (!li.show_name) {
        errors.push(`Line item ${i + 1}: show name is required`);
      }
      if (!li.post_date) {
        errors.push(`Line item ${i + 1}: post date is required`);
      }
      if (!Number(li.gross_rate) && !Number(li.net_due)) {
        errors.push(`Line item ${i + 1}: rate or net due is required`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Build Partial InsertionOrder from raw extracted/manual data ---

export function buildPartialIO(data: Record<string, unknown>): Partial<InsertionOrder> {
  const rawLineItems = Array.isArray(data.line_items) ? data.line_items : [];
  const lineItems = rawLineItems.map((li: Record<string, unknown>, i: number) =>
    normalizeLineItem(li, i)
  );
  const totals = calculateIOTotals(lineItems);

  const competitorExclusion = Array.isArray(data.competitor_exclusion)
    ? (data.competitor_exclusion as string[])
    : [];

  return {
    io_number: generateIONumber(),
    advertiser_name: (data.advertiser_name as string) || "",
    advertiser_contact_name: (data.advertiser_contact_name as string) || undefined,
    advertiser_contact_email: (data.advertiser_contact_email as string) || undefined,
    publisher_name: (data.publisher_name as string) || "",
    publisher_contact_name: (data.publisher_contact_name as string) || "",
    publisher_contact_email: (data.publisher_contact_email as string) || "",
    publisher_address: (data.publisher_address as string) || undefined,
    agency_name: (data.agency_name as string) || undefined,
    agency_contact_name: (data.agency_contact_name as string) || undefined,
    agency_contact_email: (data.agency_contact_email as string) || undefined,
    agency_billing_contact: (data.agency_billing_contact as string) || undefined,
    agency_address: (data.agency_address as string) || undefined,
    send_invoices_to: (data.send_invoices_to as string) || undefined,
    line_items: lineItems,
    ...totals,
    payment_terms: (data.payment_terms as string) || "Net 30 EOM",
    competitor_exclusion: competitorExclusion,
    exclusivity_days: Number(data.exclusivity_days) || 90,
    rofr_days: Number(data.rofr_days) || 30,
    cancellation_notice_days: Number(data.cancellation_notice_days) || 14,
    download_tracking_days: Number(data.download_tracking_days) || 45,
    make_good_threshold: Number(data.make_good_threshold) || 0.1,
    status: "draft",
  };
}
