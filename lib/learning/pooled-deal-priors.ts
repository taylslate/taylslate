// Anonymized priors from booked on-platform deals.
//
// buildPooledDealPriors is the pure form of refresh_pooled_deal_priors().
// A deal counts when its status is signed, live, delivering, or
// completed, and cancelled_at is empty. show_signed does not count.
// A group is (category, placement, price_type).
// It is kept only when at least POOL_MIN_BRANDS distinct brands are in it.
// Brand identity is coalesce(brand_profile_id, brand_id) and is dropped
// from the result. recordCount on the result is the deal count.
//
// agreed_cpm, agreed_placement, and agreed_episode_count win when set.
// Placement and price type use the import-pool vocabulary.
// Outcome impressions win over a conversion report when both are present.
// refreshPooledDealPriors calls the SQL function. The cron schedules it.

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  percentileCont,
  POOL_MIN_BRANDS,
  priorMapKey,
  toPoolPlacement,
  toPoolPriceType,
  type PooledPrior,
} from "@/lib/learning/pooled-priors";

export const POOL_BOOKED_STATUSES = new Set([
  "signed",
  "live",
  "delivering",
  "completed",
]);

export interface PooledDealSourceRow {
  brandId: string | null;
  brandProfileId: string | null;
  status: string;
  cancelledAt: string | null;
  categories: string[];
  placement: string | null;
  agreedPlacement: string | null;
  priceType: string | null;
  cpmRate: number | null;
  agreedCpm: number | null;
  episodeCount: number | null;
  agreedEpisodeCount: number | null;
  guaranteedDownloads: number | null;
  /** deal_conversion_reports.reported_conversions for this deal. */
  reportConversions: number | null;
  /** outcomes.reported_conversions joined on booking_id = deals.id. */
  outcomeConversions: number | null;
  /** outcomes.reported_impressions for that same outcome row. */
  outcomeImpressions: number | null;
}

interface DealGroup {
  category: string;
  placement: string | null;
  priceType: string | null;
  brands: Set<string>;
  deals: number;
  rates: number[];
  per1k: number[];
}

/**
 * Pure pool builder. Mirrors refresh_pooled_deal_priors().
 * Identifiers on the input are dropped.
 */
export function buildPooledDealPriors(rows: PooledDealSourceRow[]): PooledPrior[] {
  const groups = new Map<string, DealGroup>();

  for (const row of rows) {
    if (!POOL_BOOKED_STATUSES.has(row.status)) continue;
    if (row.cancelledAt != null && row.cancelledAt.trim() !== "") continue;
    const brandKey = (row.brandProfileId?.trim() || row.brandId?.trim() || "");
    if (!brandKey) continue;

    const categories = uniqueCategories(row.categories);
    if (categories.length === 0) continue;

    const placement = toPoolPlacement(
      row.agreedPlacement?.trim() ? row.agreedPlacement : row.placement
    );
    const priceType = toPoolPriceType(row.priceType);
    const rate =
      priceType === "cpm" ? (row.agreedCpm != null ? row.agreedCpm : row.cpmRate) : null;
    const per1k = conversionPer1k(row);

    for (const category of categories) {
      const key = priorMapKey(category, placement, priceType);
      let group = groups.get(key);
      if (!group) {
        group = {
          category,
          placement,
          priceType,
          brands: new Set(),
          deals: 0,
          rates: [],
          per1k: [],
        };
        groups.set(key, group);
      }
      group.brands.add(brandKey);
      group.deals += 1;
      if (rate != null && Number.isFinite(rate)) group.rates.push(rate);
      if (per1k != null) group.per1k.push(per1k);
    }
  }

  const priors: PooledPrior[] = [];
  for (const group of groups.values()) {
    if (group.brands.size < POOL_MIN_BRANDS) continue;
    priors.push({
      category: group.category,
      placement: group.placement,
      priceType: group.priceType,
      brandCount: group.brands.size,
      recordCount: group.deals,
      medianCpm: group.priceType === "cpm" ? percentileCont(0.5, group.rates) : null,
      medianConversionsPer1kDownloads: percentileCont(0.5, group.per1k),
    });
  }

  priors.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      (a.placement ?? "").localeCompare(b.placement ?? "") ||
      (a.priceType ?? "").localeCompare(b.priceType ?? "")
  );
  return priors;
}

/**
 * Rebuild pooled_deal_priors. Fail-soft. The cron calls this.
 */
export async function refreshPooledDealPriors(): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc("refresh_pooled_deal_priors");
    if (error) {
      console.warn("[learning] deal prior refresh unavailable:", error.message);
      return null;
    }
    return typeof data === "number" && Number.isFinite(data) ? data : null;
  } catch (err) {
    console.warn(
      "[learning] deal prior refresh unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function conversionPer1k(row: PooledDealSourceRow): number | null {
  const impressions = row.outcomeImpressions;
  const outcomeConversions = row.outcomeConversions;
  if (
    impressions != null &&
    Number.isFinite(impressions) &&
    impressions > 0 &&
    outcomeConversions != null &&
    Number.isFinite(outcomeConversions)
  ) {
    return (outcomeConversions * 1000) / impressions;
  }
  const episodes = row.agreedEpisodeCount ?? row.episodeCount;
  const downloads = row.guaranteedDownloads;
  const reported = row.reportConversions;
  if (
    reported != null &&
    Number.isFinite(reported) &&
    episodes != null &&
    Number.isFinite(episodes) &&
    episodes > 0 &&
    downloads != null &&
    Number.isFinite(downloads) &&
    downloads > 0
  ) {
    return (reported * 1000) / (downloads * episodes);
  }
  return null;
}

function uniqueCategories(categories: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const category of categories ?? []) {
    if (typeof category !== "string") continue;
    const trimmed = category.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}
