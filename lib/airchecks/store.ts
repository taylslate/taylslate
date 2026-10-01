// Service-role reads and the one-row-per-line upsert. The unique key is
// io_line_item_id (migration 038), so a retry updates the same row.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AircheckBuy,
  AircheckFieldCheck,
  AircheckJudgment,
  AircheckMatchEvidence,
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
