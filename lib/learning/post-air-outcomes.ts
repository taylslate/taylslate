// Reported conversions keyed by catalog show id (deals.show_id).
// Fail-soft: a missing table or a query error returns an empty map so
// discovery keeps the original scores. Never reads show_profiles.

import { supabaseAdmin } from "@/lib/supabase/admin";

const CHUNK = 80;

interface DealShowRow {
  id: string;
  show_id: string | null;
  status: string | null;
}

interface ReportRow {
  deal_id: string;
  reported_conversions: number | null;
}

/**
 * Sum of brand-reported conversions per catalog show, across campaigns.
 * Cancelled deals are skipped. A show with no report is absent from the map.
 */
export async function loadPostAirConversionsByShow(
  showIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(showIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const deals = await selectIn<DealShowRow>(
      "deals",
      "show_id",
      ids,
      "id, show_id, status"
    );
    const live = deals.filter(
      (deal) => deal.show_id && deal.status !== "cancelled"
    );
    if (live.length === 0) return new Map();
    const reports = await selectIn<ReportRow>(
      "deal_conversion_reports",
      "deal_id",
      live.map((deal) => deal.id),
      "deal_id, reported_conversions"
    );
    const showByDeal = new Map(live.map((deal) => [deal.id, deal.show_id as string]));
    const totals = new Map<string, number>();
    for (const report of reports) {
      const showId = showByDeal.get(report.deal_id);
      if (!showId) continue;
      if (
        report.reported_conversions == null ||
        !Number.isFinite(report.reported_conversions) ||
        report.reported_conversions <= 0
      ) {
        continue;
      }
      totals.set(
        showId,
        (totals.get(showId) ?? 0) + Math.trunc(report.reported_conversions)
      );
    }
    return totals;
  } catch (err) {
    console.warn(
      "[learning] post-air conversions unavailable:",
      err instanceof Error ? err.message : err
    );
    return new Map();
  }
}

async function selectIn<T>(
  table: string,
  column: string,
  ids: string[],
  columns: string
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .in(column, slice);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}
