// Reported conversions keyed by catalog show id (deals.show_id), for one
// brand. Fail-soft: a missing table or a query error returns an empty map
// so discovery keeps the original scores. Never reads show_profiles.
//
// The sum is this brand's campaigns only (campaigns.user_id). Another
// brand's report on the same catalog show does not lift it here.

import { supabaseAdmin } from "@/lib/supabase/admin";

const CHUNK = 80;

interface DealShowRow {
  id: string;
  show_id: string | null;
  status: string | null;
  campaigns: { user_id: string | null } | { user_id: string | null }[] | null;
}

interface ReportRow {
  deal_id: string;
  reported_conversions: number | null;
}

/**
 * The campaign owner's user id. Null when the campaign is missing.
 * Fail-soft. This is the brand the post-air lift is scoped to.
 */
export async function loadCampaignBrandUserId(
  campaignId: string
): Promise<string | null> {
  const id = campaignId.trim();
  if (!id) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("user_id")
      .eq("id", id)
      .maybeSingle<{ user_id: string | null }>();
    if (error || !data?.user_id?.trim()) return null;
    return data.user_id.trim();
  } catch (err) {
    console.warn(
      "[learning] campaign brand unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Sum of this brand's reported conversions per catalog show.
 * `brandUserId` is campaigns.user_id for the brand who is looking.
 * Other brands' campaigns are not included. A blank id returns an empty
 * map — there is no unscoped total. Cancelled deals are skipped. A show
 * with no report from this brand is absent from the map.
 */
export async function loadPostAirConversionsByShow(
  showIds: string[],
  brandUserId: string
): Promise<Map<string, number>> {
  const ids = [...new Set(showIds.filter(Boolean))];
  const brandId = brandUserId.trim();
  if (ids.length === 0 || !brandId) return new Map();
  try {
    const deals = await selectBrandDeals(ids, brandId);
    const live = deals.filter((deal) => deal.show_id && deal.status !== "cancelled");
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

/** Deals on these catalog shows whose campaign owner is this brand. */
async function selectBrandDeals(
  showIds: string[],
  brandUserId: string
): Promise<DealShowRow[]> {
  const out: DealShowRow[] = [];
  for (let i = 0; i < showIds.length; i += CHUNK) {
    const slice = showIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("id, show_id, status, campaigns!inner(user_id)")
      .in("show_id", slice)
      .eq("campaigns.user_id", brandUserId);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as DealShowRow[]) {
      if (campaignUserId(row) !== brandUserId) continue;
      out.push(row);
    }
  }
  return out;
}

function campaignUserId(row: DealShowRow): string | null {
  const embedded = row.campaigns;
  const campaign = Array.isArray(embedded) ? embedded[0] : embedded;
  const userId = campaign?.user_id?.trim();
  return userId || null;
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
