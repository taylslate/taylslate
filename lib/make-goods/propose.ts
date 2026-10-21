// Turn an aircheck finding into one make-good row for the line.
// Writes are scoped to the IO line's own deal. The show id written
// on the row is deals.show_id.

import { logEvent } from "@/lib/data/events";
import { detectAircheckUnderdelivery } from "@/lib/airchecks/detect";
import type { AircheckMatchEvidence, AircheckRow } from "@/lib/airchecks/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildOptions, draftAmendedTerms, type TermContext } from "./terms";
import { asMakeGoodRecord, type MakeGoodRecord } from "./types";

interface LineRow {
  id: string;
  io_id: string;
  show_name: string | null;
  placement: string | null;
  post_date: string | null;
  format: string | null;
  guaranteed_downloads: number | null;
  actual_downloads: number | null;
  price_type: string | null;
  gross_cpm: number | null;
  gross_rate: number | null;
  net_due: number | null;
  make_good_triggered?: boolean | null;
}

interface IoRow {
  id: string;
  deal_id: string;
  io_number: string | null;
  advertiser_name: string | null;
  make_good_enabled: boolean | null;
  make_good_threshold: number | null;
  total_downloads: number | null;
}

interface DealRow {
  id: string;
  show_id: string | null;
  show_profile_id: string | null;
  status: string;
}

const LINE_COLUMNS =
  "id, io_id, show_name, placement, post_date, format, guaranteed_downloads, actual_downloads, price_type, gross_cpm, gross_rate, net_due, make_good_triggered";

const IO_COLUMNS =
  "id, deal_id, io_number, advertiser_name, make_good_enabled, make_good_threshold, total_downloads";

function evidenceReason(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const reason = (value as Partial<AircheckMatchEvidence>).reason;
  return typeof reason === "string" ? reason : null;
}

async function one<T>(table: string, column: string, value: string, columns: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(columns)
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return (data as T | null) ?? null;
}

export async function listMakeGoods(dealId: string): Promise<MakeGoodRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("make_goods")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`make_goods list failed: ${error.message}`);
  return (data ?? [])
    .map((row) => asMakeGoodRecord(row))
    .filter((row): row is MakeGoodRecord => row != null);
}

/** Deal page read. A missing table (migration 048 not applied) stays empty. */
export async function listMakeGoodsFailSoft(dealId: string): Promise<MakeGoodRecord[]> {
  try {
    return await listMakeGoods(dealId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing =
      /does not exist|schema cache|42P01/i.test(message);
    if (!missing) console.error("[make-goods] list failed:", message);
    return [];
  }
}

async function showNameFor(line: LineRow, showId: string): Promise<string> {
  const named = line.show_name?.trim();
  if (named) return named;
  const show = await one<{ id: string; name: string | null }>(
    "shows",
    "id",
    showId,
    "id, name"
  );
  return show?.name?.trim() || "Show";
}

function contextFor(
  io: IoRow,
  line: LineRow,
  showId: string,
  showName: string,
  finding: ReturnType<typeof detectAircheckUnderdelivery>
): TermContext {
  if (!finding) {
    throw new Error("make-good context requires a finding");
  }
  return {
    ioNumber: io.io_number?.trim() || io.id,
    advertiserName: io.advertiser_name?.trim() || "Advertiser",
    showId,
    line: {
      showName,
      placement: line.placement?.trim() || "mid-roll",
      postDate: String(line.post_date).slice(0, 10),
      guaranteedDownloads: Number(line.guaranteed_downloads) || 0,
      actualDownloads:
        line.actual_downloads == null ? null : Number(line.actual_downloads),
      priceType: line.price_type === "flat_rate" ? "flat_rate" : "cpm",
      grossCpm: Number(line.gross_cpm) || 0,
      grossRate: Number(line.gross_rate) || 0,
      netDue: Number(line.net_due) || 0,
    },
    finding,
  };
}

async function writeProposal(input: {
  deal: DealRow;
  io: IoRow;
  line: LineRow;
  aircheck: AircheckRow | null;
  finding: NonNullable<ReturnType<typeof detectAircheckUnderdelivery>>;
  showName: string;
}): Promise<MakeGoodRecord> {
  const { deal, io, line, aircheck, finding, showName } = input;
  if (!deal.show_id) {
    throw new Error("deal has no show_id");
  }
  if (line.io_id !== io.id || io.deal_id !== deal.id) {
    throw new Error("line does not belong to this deal");
  }

  const context = contextFor(io, line, deal.show_id, showName, finding);
  const options = buildOptions(context);
  const recommended = options[0]?.id ?? "replacement_spot";
  const amended = draftAmendedTerms(context, recommended);
  const existing = await one<Record<string, unknown>>(
    "make_goods",
    "io_line_item_id",
    line.id,
    "*"
  );
  const existingRow = existing ? asMakeGoodRecord(existing) : null;
  if (existingRow && existingRow.status !== "proposed") return existingRow;

  const fields = {
    deal_id: deal.id,
    io_id: io.id,
    io_line_item_id: line.id,
    aircheck_id: aircheck?.id ?? null,
    show_id: deal.show_id,
    kind: finding.kind,
    reason: finding.reason,
    show_name: showName,
    placement: context.line.placement,
    post_date: context.line.postDate,
    guaranteed_downloads: finding.guaranteedDownloads,
    actual_downloads: finding.actualDownloads,
    shortfall_pct: finding.shortfallPct,
    threshold: finding.threshold,
    options,
    amended_terms: amended,
  };

  const { error: lineError } = await supabaseAdmin
    .from("io_line_items")
    .update({
      make_good_triggered: true,
      make_good_reason: finding.reason,
    })
    .eq("id", line.id)
    .eq("io_id", io.id);
  if (lineError) throw new Error(`line make-good flag failed: ${lineError.message}`);

  if (existingRow) {
    const { data, error } = await supabaseAdmin
      .from("make_goods")
      .update(fields)
      .eq("id", existingRow.id)
      .eq("deal_id", deal.id)
      .eq("status", "proposed")
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(`make-good refresh failed: ${error?.message ?? "no row"}`);
    }
    const saved = asMakeGoodRecord(data);
    if (!saved) throw new Error("make-good refresh returned an unreadable row");
    return saved;
  }

  const { data, error } = await supabaseAdmin
    .from("make_goods")
    .insert({
      ...fields,
      status: "proposed",
      delivery_state: "pending_approval",
      selected_option: null,
      credit_amount: null,
      replacement_line_item_id: null,
      replacement_post_date: null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`make-good insert failed: ${error?.message ?? "no row"}`);
  }
  const saved = asMakeGoodRecord(data);
  if (!saved) throw new Error("make-good insert returned an unreadable row");

  await logEvent({
    eventType: "make_good.detected",
    entityType: "make_good",
    entityId: saved.id,
    payload: {
      deal_id: deal.id,
      io_id: io.id,
      io_line_item_id: line.id,
      aircheck_id: aircheck?.id ?? null,
      show_id: deal.show_id,
      show_profile_id: deal.show_profile_id,
      kind: saved.kind,
      reason: saved.reason,
      threshold: saved.threshold,
      guaranteed_downloads: saved.guaranteed_downloads,
      actual_downloads: saved.actual_downloads,
      shortfall_pct: saved.shortfall_pct,
      delivery_state: saved.delivery_state,
    },
  });
  return saved;
}

async function proposeFromLoaded(
  deal: DealRow,
  io: IoRow,
  line: LineRow
): Promise<MakeGoodRecord | null> {
  if (!deal.show_id) return null;
  if (io.deal_id !== deal.id || line.io_id !== io.id) return null;
  if (!line.post_date) return null;

  const aircheck = await one<AircheckRow>(
    "airchecks",
    "io_line_item_id",
    line.id,
    "id, io_line_item_id, status, match_result, match_evidence, review_decision, review_reason"
  );
  const finding = detectAircheckUnderdelivery({
    makeGoodEnabled: io.make_good_enabled !== false,
    makeGoodThreshold: Number(io.make_good_threshold ?? 0.1),
    guaranteedDownloads: Number(line.guaranteed_downloads) || 0,
    actualDownloads:
      line.actual_downloads == null ? null : Number(line.actual_downloads),
    aircheck: aircheck
      ? {
          status: aircheck.status,
          match_result: aircheck.match_result,
          review_decision: aircheck.review_decision,
          reviewReason: aircheck.review_reason,
          evidenceReason: evidenceReason(aircheck.match_evidence),
        }
      : null,
  });
  if (!finding) return null;

  const showName = await showNameFor(line, deal.show_id);
  return writeProposal({ deal, io, line, aircheck, finding, showName });
}

/** System hook. The line id is the aircheck's own line, then IO, then deal. */
export async function proposeMakeGoodForLine(
  ioLineItemId: string
): Promise<MakeGoodRecord | null> {
  const line = await one<LineRow>("io_line_items", "id", ioLineItemId, LINE_COLUMNS);
  if (!line) return null;
  const io = await one<IoRow>("insertion_orders", "id", line.io_id, IO_COLUMNS);
  if (!io) return null;
  const deal = await one<DealRow>(
    "deals",
    "id",
    io.deal_id,
    "id, show_id, show_profile_id, status"
  );
  if (!deal) return null;
  return proposeFromLoaded(deal, io, line);
}

/** Caller has already verified this deal id belongs to them. */
export async function proposeMakeGoodsForDeal(dealId: string): Promise<MakeGoodRecord[]> {
  const deal = await one<DealRow>(
    "deals",
    "id",
    dealId,
    "id, show_id, show_profile_id, status"
  );
  if (!deal?.show_id) return listMakeGoods(dealId);

  const { data: ios, error } = await supabaseAdmin
    .from("insertion_orders")
    .select(IO_COLUMNS)
    .eq("deal_id", deal.id);
  if (error) throw new Error(`insertion order list failed: ${error.message}`);

  for (const io of (ios ?? []) as IoRow[]) {
    if (io.deal_id !== deal.id) continue;
    const { data: lines, error: lineError } = await supabaseAdmin
      .from("io_line_items")
      .select(LINE_COLUMNS)
      .eq("io_id", io.id);
    if (lineError) throw new Error(`line list failed: ${lineError.message}`);
    for (const line of (lines ?? []) as LineRow[]) {
      if (line.io_id !== io.id) continue;
      await proposeFromLoaded(deal, io, line);
    }
  }
  return listMakeGoods(deal.id);
}
