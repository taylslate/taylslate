// Pure helpers for the past-campaign review screen.
// They shape the save body, block bad edits, and label catalog suggestions.
// They do not query, write, or attach a row to a show.

export const POOLING_TERMS_VERSION = "pooling-v1";
export const DEFAULT_POOLING_CONSENT = false;

const PRICE_TYPES = ["cpm", "flat"] as const;
const PLACEMENTS = ["pre-roll", "mid-roll", "post-roll"] as const;
const SOURCE_KINDS = ["csv", "xlsx", "pdf"] as const;
const PG_INT_MAX = 2_147_483_647;

export type ReviewPriceType = (typeof PRICE_TYPES)[number];
export type ReviewPlacement = (typeof PLACEMENTS)[number];
export type ReviewSourceKind = (typeof SOURCE_KINDS)[number];

export interface CatalogHint {
  id: string;
  name: string;
}

export interface ParsedDraft {
  show_name?: unknown;
  matched_show_id?: unknown;
  flight_start?: unknown;
  flight_end?: unknown;
  placement?: unknown;
  price_type?: unknown;
  rate?: unknown;
  episodes?: unknown;
  spend?: unknown;
  conversions?: unknown;
  downloads?: unknown;
  raw?: unknown;
}

export interface ReviewRow {
  id: string;
  showName: string;
  flightStart: string;
  flightEnd: string;
  placement: string;
  priceType: "" | ReviewPriceType;
  price: string;
  episodes: string;
  spend: string;
  conversions: string;
  downloads: string;
  raw: Record<string, unknown>;
  removed: boolean;
}

export interface ReviewFieldError {
  id: string;
  field: string;
  message: string;
}

export interface PastCampaignSaveBody {
  brand_id: string;
  source_kind: ReviewSourceKind;
  file_name: string | null;
  pooling_consent: boolean;
  terms_version: string | null;
  records: PastCampaignSaveRecord[];
}

export interface PastCampaignSaveRecord {
  show_name: string;
  matched_show_id: null;
  flight_start: string | null;
  flight_end: string | null;
  placement: string | null;
  price_type: ReviewPriceType | null;
  rate: number | null;
  episodes: number | null;
  spend: number | null;
  conversions: number | null;
  downloads: number | null;
  raw: Record<string, unknown>;
}

export class ReviewInputError extends Error {
  readonly errors: ReviewFieldError[];

  constructor(errors: ReviewFieldError[]) {
    super(errors[0]?.message ?? "Fix the highlighted rows before confirming.");
    this.name = "ReviewInputError";
    this.errors = errors;
  }
}

export function defaultPoolingConsent(): boolean {
  return DEFAULT_POOLING_CONSENT;
}

export function importLede(brandName: string): string {
  const advisory =
    "The catalog suggestion is advisory. The brand keeps the row either way.";
  const name = brandName.trim();
  return name
    ? `${name} brings in an old campaign file. ${advisory}`
    : advisory;
}

export function sourceKindLabel(kind: ReviewSourceKind): string {
  if (kind === "csv") return "CSV";
  if (kind === "xlsx") return "XLSX";
  return "PDF";
}

export function placementLabel(value: string): string {
  if (value === "pre-roll") return "Pre-roll";
  if (value === "mid-roll") return "Mid-roll";
  if (value === "post-roll") return "Post-roll";
  return value;
}

export function priceTypeLabel(value: string): string {
  if (value === "cpm") return "CPM";
  if (value === "flat") return "Flat rate";
  return "Unset";
}

export function recordCountLabel(count: number): string {
  return count === 1 ? "1 record saved." : `${count} records saved.`;
}

export function messageFromApi(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === "string" && error.length > 0) return error;
  }
  return fallback;
}

export function readParsePayload(
  payload: unknown
):
  | {
      ok: true;
      sourceKind: ReviewSourceKind;
      fileName: string | null;
      drafts: ParsedDraft[];
    }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Could not read this file." };
  }
  const record = payload as Record<string, unknown>;
  const kind = record.source_kind;
  if (kind !== "csv" && kind !== "xlsx" && kind !== "pdf") {
    return { ok: false, error: "Could not read this file." };
  }
  if (!Array.isArray(record.drafts)) {
    return { ok: false, error: "Could not read this file." };
  }
  const fileName = typeof record.file_name === "string" ? record.file_name : null;
  return {
    ok: true,
    sourceKind: kind,
    fileName,
    drafts: record.drafts as ParsedDraft[],
  };
}

export function draftsToRows(drafts: ParsedDraft[]): ReviewRow[] {
  return drafts.map((draft, index) => ({
    id: `row-${index + 1}`,
    showName: text(draft.show_name),
    flightStart: dateText(draft.flight_start),
    flightEnd: dateText(draft.flight_end),
    placement: text(draft.placement).trim().slice(0, 80),
    priceType: priceTypeOrBlank(draft.price_type),
    price: numberText(draft.rate),
    episodes: numberText(draft.episodes),
    spend: numberText(draft.spend),
    conversions: numberText(draft.conversions),
    downloads: numberText(draft.downloads),
    raw: plainRaw(draft.raw),
    removed: false,
  }));
}

// Same rule as lookupShowHints: one exact, case-insensitive name is a
// suggestion. Zero or several stay unlabeled. The label never includes an id.
export function catalogSuggestionLabel(showName: string, hints: CatalogHint[]): string {
  const key = showName.trim().toLowerCase();
  if (!key) return "No catalog suggestion.";
  const hits = hints.filter((hint) => hint.name.trim().toLowerCase() === key);
  if (hits.length !== 1) return "No catalog suggestion.";
  return `Catalog suggestion: ${hits[0].name}. The imported name stays unless you change it.`;
}

export function placementChoices(current: string): string[] {
  if (current && !PLACEMENTS.includes(current as ReviewPlacement)) {
    return [current, ...PLACEMENTS];
  }
  return [...PLACEMENTS];
}

export function rowEditErrors(rows: ReviewRow[]): ReviewFieldError[] {
  const errors: ReviewFieldError[] = [];
  for (const row of rows) {
    if (row.removed) continue;
    if (!row.showName.trim()) {
      errors.push({ id: row.id, field: "showName", message: "Enter a show name." });
    }
    const start = parseDate(row.flightStart);
    if (!start.ok) {
      errors.push({
        id: row.id,
        field: "flightStart",
        message: "Use a real date, or leave it blank.",
      });
    }
    const end = parseDate(row.flightEnd);
    if (!end.ok) {
      errors.push({
        id: row.id,
        field: "flightEnd",
        message: "Use a real date, or leave it blank.",
      });
    }
    const price = parseMoney(row.price);
    if (!price.ok) {
      errors.push({
        id: row.id,
        field: "price",
        message: "Enter a price as a number, or leave it blank.",
      });
    }
    const spend = parseMoney(row.spend);
    if (!spend.ok) {
      errors.push({
        id: row.id,
        field: "spend",
        message: "Enter spend as a number, or leave it blank.",
      });
    }
    for (const field of ["episodes", "conversions", "downloads"] as const) {
      const parsed = parseCount(row[field]);
      if (!parsed.ok) {
        errors.push({
          id: row.id,
          field,
          message: "Enter a whole number, or leave it blank.",
        });
      }
    }
  }
  return errors;
}

export function rowsToSaveBody(input: {
  brandId: string;
  sourceKind: ReviewSourceKind;
  fileName: string | null;
  rows: ReviewRow[];
  poolingConsent?: boolean;
}): PastCampaignSaveBody {
  const brandId = input.brandId.trim();
  if (!brandId) {
    throw new ReviewInputError([
      { id: "", field: "brand_id", message: "Missing brand." },
    ]);
  }
  const active = input.rows.filter((row) => !row.removed);
  if (active.length === 0) {
    throw new ReviewInputError([
      {
        id: "",
        field: "records",
        message: "At least one campaign row is required",
      },
    ]);
  }
  const errors = rowEditErrors(active);
  if (errors.length > 0) throw new ReviewInputError(errors);

  const poolingConsent = input.poolingConsent ?? defaultPoolingConsent();
  return {
    brand_id: brandId,
    source_kind: input.sourceKind,
    file_name: cleanFileName(input.fileName),
    pooling_consent: poolingConsent,
    terms_version: poolingConsent ? POOLING_TERMS_VERSION : null,
    records: active.map((row) => toRecord(row)),
  };
}

function toRecord(row: ReviewRow): PastCampaignSaveRecord {
  const price = parseMoney(row.price);
  const spend = parseMoney(row.spend);
  const episodes = parseCount(row.episodes);
  const conversions = parseCount(row.conversions);
  const downloads = parseCount(row.downloads);
  const start = parseDate(row.flightStart);
  const end = parseDate(row.flightEnd);
  if (
    !price.ok ||
    !spend.ok ||
    !episodes.ok ||
    !conversions.ok ||
    !downloads.ok ||
    !start.ok ||
    !end.ok
  ) {
    throw new ReviewInputError([
      { id: row.id, field: "price", message: "Enter a price as a number, or leave it blank." },
    ]);
  }
  return {
    show_name: row.showName.trim().slice(0, 500),
    matched_show_id: null,
    flight_start: start.value,
    flight_end: end.value,
    placement: row.placement.trim() ? row.placement.trim().slice(0, 80) : null,
    price_type: row.priceType || null,
    rate: price.amount,
    episodes: episodes.amount,
    spend: spend.amount,
    conversions: conversions.amount,
    downloads: downloads.amount,
    raw: row.raw,
  };
}

function parseMoney(
  value: string
): { ok: true; amount: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, amount: null };
  const cleaned = trimmed.replace(/[$,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };
  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

function parseCount(
  value: string
): { ok: true; amount: number | null } | { ok: false } {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return { ok: true, amount: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const amount = Number(trimmed);
  if (!Number.isInteger(amount) || amount < 0 || amount > PG_INT_MAX) return { ok: false };
  return { ok: true, amount };
}

function parseDate(
  value: string
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function cleanFileName(value: string | null): string | null {
  if (!value) return null;
  const base = value.trim().split(/[/\\]/).pop()?.trim() ?? "";
  if (!base) return null;
  return base.slice(0, 200);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function dateText(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function numberText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  return "";
}

function priceTypeOrBlank(value: unknown): "" | ReviewPriceType {
  if (value === "cpm" || value === "flat") return value;
  return "";
}

function plainRaw(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}
