// Service-role reads and the one-row-per-line upsert. The unique key is
// io_line_item_id (migration 038), so a retry updates the same row.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AircheckBuy,
  AircheckFieldCheck,
  AircheckJudgment,
  AircheckMatchEvidence,
  AircheckQueueRow,
  AircheckReviewView,
  AircheckRow,
  AircheckWrite,
} from "./types";

interface LineRow {
  id: string;
  io_id: string;
  episode_url: string | null;
  post_date: string | null;
  format: string;
  show_name: string | null;
  placement: string | null;
}

interface IoRow {
  id: string;
  deal_id: string;
}

interface DealRow {
  id: string;
  show_id: string;
  promo_code: string | null;
  brand_profile_id: string | null;
}

interface InsertionOrderBuyRow {
  id: string;
  deal_id: string;
  advertiser_name: string | null;
  publisher_name: string | null;
}

interface BrandBuyRow {
  id: string;
  brand_name: string | null;
  brand_website: string | null;
}

interface ShowRow {
  id: string;
  name: string | null;
  rss_url: string | null;
}

export interface AircheckReviewPatch {
  review_decision?: AircheckRow["review_decision"];
  review_reason?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  charge_error?: string | null;
  confirm_claimed_at?: string | null;
  confirm_claimed_by?: string | null;
}

/** Columns the queue may read. No transcript, audio URL, or decided_by. */
export const AIRCHECK_QUEUE_AIRCHECK_COLUMNS =
  "id,io_line_item_id,match_result,confidence,matched_at,charge_error,ready_for_review";

export const AIRCHECK_QUEUE_LINE_COLUMNS = "id,show_name,placement,io_id";

export const AIRCHECK_QUEUE_IO_COLUMNS = "id,advertiser_name";

export const AIRCHECK_QUEUE_LIMIT = 50;

/** A claim older than this can be taken again. */
export const AIRCHECK_CONFIRM_CLAIM_MS = 5 * 60 * 1000;

export interface AircheckLineDeal {
  dealId: string;
  status: string | null;
  cancelledAt: string | null;
}

export function isAircheckClaimColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /confirm_claimed_at|42703|PGRST204/i.test(`${code} ${message}`)
  );
}

async function maybeOne<T>(
  table: string,
  column: string,
  value: string
): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return (data as T | null) ?? null;
}

export async function loadIoLine(ioLineItemId: string): Promise<LineRow | null> {
  return maybeOne<LineRow>("io_line_items", "id", ioLineItemId);
}

/** Show RSS for the line, via IO → deal → show. Null when any join is missing. */
export async function loadShowRssUrl(ioId: string): Promise<string | null> {
  const io = await maybeOne<IoRow>("insertion_orders", "id", ioId);
  if (!io?.deal_id) return null;
  const deal = await maybeOne<DealRow>("deals", "id", io.deal_id);
  if (!deal?.show_id) return null;
  const show = await maybeOne<ShowRow>("shows", "id", deal.show_id);
  const rss = show?.rss_url?.trim();
  return rss || null;
}

export async function findAircheckByLine(
  ioLineItemId: string
): Promise<AircheckRow | null> {
  return maybeOne<AircheckRow>("airchecks", "io_line_item_id", ioLineItemId);
}

export async function saveAircheck(row: AircheckWrite): Promise<AircheckRow> {
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .upsert(row, { onConflict: "io_line_item_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`aircheck save failed: ${error?.message ?? "no row returned"}`);
  }
  return data as AircheckRow;
}

function names(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Buy fields for one line, from the IO, the deal, and the brand profile. */
export async function loadAircheckBuy(
  ioLineItemId: string
): Promise<AircheckBuy | null> {
  const line = await loadIoLine(ioLineItemId);
  if (!line) return null;
  const io = await maybeOne<InsertionOrderBuyRow>("insertion_orders", "id", line.io_id);
  const deal = io?.deal_id
    ? await maybeOne<DealRow>("deals", "id", io.deal_id)
    : null;
  const brand = deal?.brand_profile_id
    ? await maybeOne<BrandBuyRow>("brand_profiles", "id", deal.brand_profile_id)
    : null;
  const code = deal?.promo_code?.trim() || null;
  const url = brand?.brand_website?.trim() || null;
  return {
    brandNames: names(io?.advertiser_name, brand?.brand_name),
    promoCode: code,
    url,
    placement: line.placement?.trim() || null,
    // No column stores the script or talking points.
    talkingPoints: null,
  };
}

/** Update the match columns on the line's existing row. Does not insert. */
export async function saveAircheckMatch(
  ioLineItemId: string,
  judgment: AircheckJudgment
): Promise<AircheckRow> {
  const matchedAt =
    judgment.match_result === "skipped" ? null : new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .update({
      match_result: judgment.match_result,
      match_evidence: judgment.match_evidence,
      matched_at: matchedAt,
    })
    .eq("io_line_item_id", ioLineItemId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `aircheck match save failed: ${error?.message ?? "no row returned"}`
    );
  }
  return data as AircheckRow;
}

const CHECKS: AircheckFieldCheck[] = ["found", "missing"];

function asCheck(value: unknown): AircheckFieldCheck {
  return CHECKS.includes(value as AircheckFieldCheck)
    ? (value as AircheckFieldCheck)
    : "missing";
}

function asEvidence(value: unknown): AircheckMatchEvidence | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AircheckMatchEvidence>;
  return {
    excerpt: typeof row.excerpt === "string" ? row.excerpt : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    brand: asCheck(row.brand),
    code_or_url: asCheck(row.code_or_url),
    position: asCheck(row.position),
    length: asCheck(row.length),
  };
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/** Facts the review screen shows. Null when the IO line does not exist. */
export async function loadAircheckReview(
  ioLineItemId: string
): Promise<AircheckReviewView | null> {
  const line = await loadIoLine(ioLineItemId);
  if (!line) return null;
  const io = await maybeOne<InsertionOrderBuyRow>("insertion_orders", "id", line.io_id);
  const deal = io?.deal_id
    ? await maybeOne<DealRow>("deals", "id", io.deal_id)
    : null;
  const brand = deal?.brand_profile_id
    ? await maybeOne<BrandBuyRow>("brand_profiles", "id", deal.brand_profile_id)
    : null;
  const show = deal?.show_id
    ? await maybeOne<ShowRow>("shows", "id", deal.show_id)
    : null;
  const aircheck = await findAircheckByLine(ioLineItemId);
  const evidence = asEvidence(aircheck?.match_evidence);
  const showName =
    blank(line.show_name) ?? blank(show?.name) ?? blank(io?.publisher_name) ?? "Show";
  return {
    ioLineItemId,
    showName,
    advertiserName: blank(io?.advertiser_name),
    brandName: blank(brand?.brand_name),
    promoCode: blank(deal?.promo_code),
    url: blank(brand?.brand_website),
    placement: blank(line.placement),
    hasAircheck: Boolean(aircheck),
    matchResult: aircheck?.match_result ?? null,
    excerpt: evidence?.excerpt ?? null,
    skipReason: evidence?.reason ?? null,
    checks: evidence
      ? {
          brand: evidence.brand,
          codeOrUrl: evidence.code_or_url,
          position: evidence.position,
          length: evidence.length,
        }
      : null,
    reviewDecision: aircheck?.review_decision ?? null,
    reviewReason: aircheck?.review_reason ?? null,
    decidedBy: aircheck?.decided_by ?? null,
    decidedAt: aircheck?.decided_at ?? null,
    chargeError: aircheck?.charge_error ?? null,
  };
}

/** The line's deal, through io_line_items.io_id to insertion_orders.deal_id. */
export async function loadAircheckLineDeal(
  ioLineItemId: string
): Promise<AircheckLineDeal | null> {
  const line = await loadIoLine(ioLineItemId);
  if (!line?.io_id) return null;
  const io = await maybeOne<IoRow>("insertion_orders", "id", line.io_id);
  if (!io?.deal_id) return null;
  const deal = await maybeOne<
    DealRow & { status?: string | null; cancelled_at?: string | null }
  >("deals", "id", io.deal_id);
  if (!deal?.id) return null;
  const status = typeof deal.status === "string" ? deal.status : null;
  const cancelledAt =
    typeof deal.cancelled_at === "string" && deal.cancelled_at.trim()
      ? deal.cancelled_at
      : null;
  return { dealId: deal.id, status, cancelledAt };
}

function quoteClaimFilter(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * One conditional update. Zero rows means the line is already decided
 * or another review still holds a claim younger than 5 minutes.
 * A missing confirm_claimed_at column throws. Callers must not charge.
 */
export async function claimAircheckConfirm(
  ioLineItemId: string,
  decidedBy: string
): Promise<AircheckRow | null> {
  const cutoff = new Date(Date.now() - AIRCHECK_CONFIRM_CLAIM_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .update({
      confirm_claimed_at: new Date().toISOString(),
      confirm_claimed_by: decidedBy,
    })
    .eq("io_line_item_id", ioLineItemId)
    .is("review_decision", null)
    .or(
      `confirm_claimed_at.is.null,confirm_claimed_at.lt.${quoteClaimFilter(cutoff)}`
    )
    .select("*")
    .maybeSingle();
  if (error) {
    if (isAircheckClaimColumnError(error)) {
      const missing = new Error(
        "Confirm is unavailable until migration 080 is applied."
      );
      (missing as Error & { code?: string }).code = error.code ?? "42703";
      throw missing;
    }
    if (error.code === "PGRST116") return null;
    throw new Error(`aircheck claim failed: ${error.message}`);
  }
  return (data as AircheckRow | null) ?? null;
}

/** Clears the claim. Does not change review_decision. */
export async function releaseAircheckConfirm(ioLineItemId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("airchecks")
    .update({
      confirm_claimed_at: null,
      confirm_claimed_by: null,
    })
    .eq("io_line_item_id", ioLineItemId);
  if (error && !isAircheckClaimColumnError(error)) {
    throw new Error(`aircheck claim release failed: ${error.message}`);
  }
}

interface QueueAircheck {
  id: string;
  io_line_item_id: string;
  match_result: string | null;
  confidence: number | string | null;
  matched_at: string | null;
  charge_error: string | null;
  ready_for_review: boolean | null;
}

interface QueueLine {
  id: string;
  show_name: string | null;
  placement: string | null;
  io_id: string | null;
}

interface QueueIo {
  id: string;
  advertiser_name: string | null;
}

function asMatch(value: string | null): AircheckQueueRow["matchResult"] {
  if (value === "matched" || value === "not_matched" || value === "skipped") {
    return value;
  }
  return null;
}

function asConfidence(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function blankQueue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

async function loadQueueContext(ids: string[]): Promise<{
  lines: Map<string, QueueLine>;
  ios: Map<string, QueueIo>;
}> {
  const lines = new Map<string, QueueLine>();
  const ios = new Map<string, QueueIo>();
  if (ids.length === 0) return { lines, ios };
  const { data: lineRows, error: lineError } = await supabaseAdmin
    .from("io_line_items")
    .select(AIRCHECK_QUEUE_LINE_COLUMNS)
    .in("id", ids);
  if (lineError) {
    throw new Error(`io_line_items lookup failed: ${lineError.message}`);
  }
  for (const row of (lineRows ?? []) as QueueLine[]) lines.set(row.id, row);
  const ioIds = [
    ...new Set(
      [...lines.values()]
        .map((line) => line.io_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (ioIds.length === 0) return { lines, ios };
  const { data: ioRows, error: ioError } = await supabaseAdmin
    .from("insertion_orders")
    .select(AIRCHECK_QUEUE_IO_COLUMNS)
    .in("id", ioIds);
  if (ioError) {
    throw new Error(`insertion_orders lookup failed: ${ioError.message}`);
  }
  for (const row of (ioRows ?? []) as QueueIo[]) ios.set(row.id, row);
  return { lines, ios };
}

function toQueueRow(
  row: QueueAircheck,
  lines: Map<string, QueueLine>,
  ios: Map<string, QueueIo>
): AircheckQueueRow {
  const line = lines.get(row.io_line_item_id);
  const io = line?.io_id ? ios.get(line.io_id) : undefined;
  return {
    id: row.id,
    ioLineItemId: row.io_line_item_id,
    showName: blankQueue(line?.show_name) ?? "Show",
    advertiserName: blankQueue(io?.advertiser_name),
    placement: blankQueue(line?.placement),
    matchResult: asMatch(row.match_result),
    confidence: asConfidence(row.confidence),
    matchedAt: row.matched_at,
    chargeError: blankQueue(row.charge_error),
  };
}

async function loadQueueGroup(
  mode: "ready" | "charge_failed"
): Promise<QueueAircheck[]> {
  let query = supabaseAdmin
    .from("airchecks")
    .select(AIRCHECK_QUEUE_AIRCHECK_COLUMNS)
    .is("review_decision", null);
  query =
    mode === "ready"
      ? query.eq("ready_for_review", true)
      : query.not("charge_error", "is", null);
  const { data, error } = await query
    .order("matched_at", { ascending: false })
    .limit(AIRCHECK_QUEUE_LIMIT);
  if (error) throw new Error(`aircheck queue failed: ${error.message}`);
  return (data ?? []) as QueueAircheck[];
}

/** Ready rows, then rows whose charge failed and still have no decision. */
export async function loadAircheckQueue(): Promise<{
  ready: AircheckQueueRow[];
  chargeFailed: AircheckQueueRow[];
}> {
  const readyRows = await loadQueueGroup("ready");
  const failedRows = await loadQueueGroup("charge_failed");
  const ids = [
    ...new Set(
      [...readyRows, ...failedRows].map((row) => row.io_line_item_id)
    ),
  ];
  const { lines, ios } = await loadQueueContext(ids);
  return {
    ready: readyRows.map((row) => toQueueRow(row, lines, ios)),
    chargeFailed: failedRows.map((row) => toQueueRow(row, lines, ios)),
  };
}

/** Update review columns on the line's existing row. Does not insert. */
export async function saveAircheckReview(
  ioLineItemId: string,
  patch: AircheckReviewPatch
): Promise<AircheckRow> {
  const { data, error } = await supabaseAdmin
    .from("airchecks")
    .update(patch)
    .eq("io_line_item_id", ioLineItemId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `aircheck review save failed: ${error?.message ?? "no row returned"}`
    );
  }
  return data as AircheckRow;
}
