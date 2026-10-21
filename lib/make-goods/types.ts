// Make-good row. Column names match public.make_goods (migration 048).
// Approval records amended terms in the app. It does not send DocuSign
// and it does not charge.

export type MakeGoodKind = "missed" | "short";

export type MakeGoodStatus = "proposed" | "approved" | "declined";

export type MakeGoodDeliveryState =
  | "pending_approval"
  | "scheduled"
  | "credited"
  | "declined";

export type MakeGoodOptionId = "replacement_spot" | "reair" | "credit_shortfall";

export interface MakeGoodOption {
  id: MakeGoodOptionId;
  label: string;
  summary: string;
}

export interface MakeGoodRecord {
  id: string;
  deal_id: string;
  io_id: string;
  io_line_item_id: string;
  aircheck_id: string | null;
  /** deals.show_id. Never show_profiles.podscan_id. */
  show_id: string;
  kind: MakeGoodKind;
  status: MakeGoodStatus;
  delivery_state: MakeGoodDeliveryState;
  reason: string;
  show_name: string;
  placement: string;
  post_date: string;
  guaranteed_downloads: number;
  actual_downloads: number | null;
  shortfall_pct: number | null;
  threshold: number;
  options: MakeGoodOption[];
  selected_option: MakeGoodOptionId | null;
  amended_terms: string;
  credit_amount: number | null;
  replacement_line_item_id: string | null;
  replacement_post_date: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

const KINDS: MakeGoodKind[] = ["missed", "short"];
const STATUSES: MakeGoodStatus[] = ["proposed", "approved", "declined"];
const DELIVERY: MakeGoodDeliveryState[] = [
  "pending_approval",
  "scheduled",
  "credited",
  "declined",
];
const OPTIONS: MakeGoodOptionId[] = ["replacement_spot", "reair", "credit_shortfall"];

export function isMakeGoodOptionId(value: unknown): value is MakeGoodOptionId {
  return OPTIONS.includes(value as MakeGoodOptionId);
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asOptions(value: unknown): MakeGoodOption[] {
  if (!Array.isArray(value)) return [];
  const out: MakeGoodOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<MakeGoodOption>;
    if (!isMakeGoodOptionId(row.id)) continue;
    if (typeof row.label !== "string" || typeof row.summary !== "string") continue;
    out.push({ id: row.id, label: row.label, summary: row.summary });
  }
  return out;
}

export function asMakeGoodRecord(value: unknown): MakeGoodRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MakeGoodRecord>;
  if (typeof row.id !== "string" || typeof row.deal_id !== "string") return null;
  if (!KINDS.includes(row.kind as MakeGoodKind)) return null;
  if (!STATUSES.includes(row.status as MakeGoodStatus)) return null;
  const delivery = DELIVERY.includes(row.delivery_state as MakeGoodDeliveryState)
    ? (row.delivery_state as MakeGoodDeliveryState)
    : "pending_approval";
  const guaranteed = num(row.guaranteed_downloads);
  const threshold = num(row.threshold);
  if (guaranteed == null || threshold == null) return null;
  if (typeof row.show_id !== "string" || typeof row.reason !== "string") return null;
  return {
    id: row.id,
    deal_id: row.deal_id,
    io_id: String(row.io_id),
    io_line_item_id: String(row.io_line_item_id),
    aircheck_id: row.aircheck_id ?? null,
    show_id: row.show_id,
    kind: row.kind as MakeGoodKind,
    status: row.status as MakeGoodStatus,
    delivery_state: delivery,
    reason: row.reason,
    show_name: row.show_name ?? "Show",
    placement: row.placement ?? "mid-roll",
    post_date: String(row.post_date ?? "").slice(0, 10),
    guaranteed_downloads: guaranteed,
    actual_downloads: num(row.actual_downloads),
    shortfall_pct: num(row.shortfall_pct),
    threshold,
    options: asOptions(row.options),
    selected_option: isMakeGoodOptionId(row.selected_option) ? row.selected_option : null,
    amended_terms: row.amended_terms ?? "",
    credit_amount: num(row.credit_amount),
    replacement_line_item_id: row.replacement_line_item_id ?? null,
    replacement_post_date: row.replacement_post_date
      ? String(row.replacement_post_date).slice(0, 10)
      : null,
    decided_by: row.decided_by ?? null,
    decided_at: row.decided_at ?? null,
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
  };
}
