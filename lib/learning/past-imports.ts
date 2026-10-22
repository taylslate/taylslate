// Brand-private confirmed past-campaign imports, keyed by the catalog
// show the brand matched. Fail-soft: a missing table or a query error
// returns an empty map so discovery keeps today's scores.
//
// A blank brand id returns an empty map and does not query. Every read
// filters brand_id to that brand. Another brand's rows are dropped even
// if a query returned them. pooling_consent is not a filter here: a
// brand's own confirmed imports are a private signal whether or not
// they may enter the anonymized pool.
//
// matched_show_id is the brand's hint for which catalog show the row
// belongs to. It is not a trust tie and it is not written back onto
// the show.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ImportBrandSignal } from "@/lib/scoring/import-lift";

const CHUNK = 80;

export interface ConfirmedImportRecord {
  id: string;
  showName: string;
  matchedShowId: string | null;
  placement: string | null;
  priceType: string | null;
  spend: number | null;
  conversions: number | null;
  downloads: number | null;
}

interface ImportHead {
  id: string;
  brand_id: string | null;
  status: string | null;
}

interface RecordRow {
  id?: string | null;
  import_id: string | null;
  brand_id: string | null;
  show_name?: string | null;
  matched_show_id: string | null;
  placement?: string | null;
  price_type?: string | null;
  spend?: number | string | null;
  conversions?: number | string | null;
  downloads?: number | string | null;
}

/**
 * This brand's confirmed import totals per catalog show.
 * Shows with no confirmed row for this brand are absent.
 */
export async function loadImportSignalsByShow(
  showIds: string[],
  brandUserId: string
): Promise<Map<string, ImportBrandSignal>> {
  const ids = [...new Set(showIds.map((id) => id.trim()).filter(Boolean))];
  const brandId = brandUserId.trim();
  if (ids.length === 0 || !brandId) return new Map();

  try {
    const importIds = await confirmedImportIds(brandId);
    if (importIds.length === 0) return new Map();
    const records = await selectSignalRecords(ids, brandId, importIds);
    return sumByShow(records, brandId, new Set(importIds));
  } catch (err) {
    console.warn(
      "[learning] import signals unavailable:",
      err instanceof Error ? err.message : err
    );
    return new Map();
  }
}

/**
 * This brand's confirmed import rows, including rows with no catalog
 * match. Fail-soft. A blank brand id returns an empty list.
 */
export async function loadConfirmedImportRecords(
  brandUserId: string
): Promise<ConfirmedImportRecord[]> {
  const brandId = brandUserId.trim();
  if (!brandId) return [];

  try {
    const importIds = await confirmedImportIds(brandId);
    if (importIds.length === 0) return [];
    const records = await selectHistoryRecords(brandId, importIds);
    const allowed = new Set(importIds);
    const out: ConfirmedImportRecord[] = [];
    for (const row of records) {
      if (row.brand_id !== brandId) continue;
      if (!row.import_id || !allowed.has(row.import_id)) continue;
      const presented = presentRecord(row);
      if (presented) out.push(presented);
    }
    return out;
  } catch (err) {
    console.warn(
      "[learning] imported history unavailable:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

async function confirmedImportIds(brandId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("past_campaign_imports")
    .select("id, brand_id, status")
    .eq("brand_id", brandId)
    .eq("status", "confirmed");
  if (error) throw new Error(error.message);

  const ids: string[] = [];
  for (const row of (data ?? []) as ImportHead[]) {
    if (row.brand_id !== brandId) continue;
    if (row.status !== "confirmed") continue;
    if (row.id) ids.push(row.id);
  }
  return ids;
}

async function selectSignalRecords(
  showIds: string[],
  brandId: string,
  importIds: string[]
): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  for (const importChunk of chunk(importIds)) {
    for (const showChunk of chunk(showIds)) {
      const { data, error } = await supabaseAdmin
        .from("past_campaign_records")
        .select("import_id, brand_id, matched_show_id, conversions, spend, downloads")
        .eq("brand_id", brandId)
        .in("import_id", importChunk)
        .in("matched_show_id", showChunk);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as RecordRow[]));
    }
  }
  return out;
}

async function selectHistoryRecords(
  brandId: string,
  importIds: string[]
): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  for (const importChunk of chunk(importIds)) {
    const { data, error } = await supabaseAdmin
      .from("past_campaign_records")
      .select(
        "id, import_id, brand_id, show_name, matched_show_id, placement, price_type, spend, conversions, downloads"
      )
      .eq("brand_id", brandId)
      .in("import_id", importChunk);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as RecordRow[]));
  }
  return out;
}

function sumByShow(
  records: RecordRow[],
  brandId: string,
  importIds: Set<string>
): Map<string, ImportBrandSignal> {
  const totals = new Map<string, ImportBrandSignal>();
  for (const row of records) {
    if (row.brand_id !== brandId) continue;
    if (!row.import_id || !importIds.has(row.import_id)) continue;
    const showId = row.matched_show_id?.trim();
    if (!showId) continue;
    const current = totals.get(showId) ?? {
      records: 0,
      conversions: 0,
      spend: 0,
      downloads: 0,
    };
    current.records += 1;
    current.conversions += nonNegative(row.conversions) ?? 0;
    current.spend += nonNegative(row.spend) ?? 0;
    current.downloads += nonNegative(row.downloads) ?? 0;
    totals.set(showId, current);
  }
  return totals;
}

function presentRecord(row: RecordRow): ConfirmedImportRecord | null {
  const showName = row.show_name?.trim() || "";
  const matchedShowId = row.matched_show_id?.trim() || null;
  if (!showName && !matchedShowId) return null;
  return {
    id: row.id?.trim() || matchedShowId || showName,
    showName: showName || "Show unavailable",
    matchedShowId,
    placement: row.placement ?? null,
    priceType: row.price_type ?? null,
    spend: nonNegative(row.spend),
    conversions: nonNegative(row.conversions),
    downloads: nonNegative(row.downloads),
  };
}

function nonNegative(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function chunk(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(ids.slice(i, i + CHUNK));
  }
  return out;
}
