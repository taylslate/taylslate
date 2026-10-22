// Anonymized priors from consented, confirmed past-campaign imports.
//
// buildPooledPriors is the pure form of refresh_pooled_import_priors().
// A group is (category, placement, price_type). It is kept only when
// at least POOL_MIN_BRANDS distinct brands consented and confirmed.
// Brand, import, record, and show identifiers are not on the result.
// Rows that are not confirmed, not consented, unmatched, or missing a
// category are skipped.
//
// The median is percentile_cont(0.5): position 1 + 0.5 * (n - 1),
// interpolated. medianCpm is set only for price type cpm.
//
// loadPooledPriors reads public.pooled_import_priors as service_role.
// refreshPooledImportPriors calls the SQL function. Nothing in this
// module schedules that call.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { IMPORT_POOL_MIN_BRANDS } from "@/lib/scoring/import-lift";

export const POOL_MIN_BRANDS = IMPORT_POOL_MIN_BRANDS;

export interface PooledPriorSourceRow {
  brandId: string;
  status: string;
  poolingConsent: boolean;
  matchedShowId: string | null;
  categories: string[];
  placement: string | null;
  priceType: string | null;
  rate: number | null;
  conversions: number | null;
  downloads: number | null;
}

export interface PooledPrior {
  category: string;
  placement: string | null;
  priceType: string | null;
  brandCount: number;
  recordCount: number;
  medianCpm: number | null;
  medianConversionsPer1kDownloads: number | null;
}

export interface PooledPriorKey {
  category: string;
  placement: string | null;
  priceType: string | null;
}

interface PriorGroup {
  category: string;
  placement: string | null;
  priceType: string | null;
  brands: Set<string>;
  records: number;
  rates: number[];
  per1k: number[];
}

interface RawPriorRow {
  category: string | null;
  placement: string | null;
  price_type: string | null;
  brand_count: number | string | null;
  record_count: number | string | null;
  median_cpm: number | string | null;
  median_conversions_per_1k_downloads: number | string | null;
}

/**
 * Pure pool builder. Mirrors refresh_pooled_import_priors().
 * Identifiers on the input are dropped.
 */
export function buildPooledPriors(rows: PooledPriorSourceRow[]): PooledPrior[] {
  const groups = new Map<string, PriorGroup>();

  for (const row of rows) {
    if (row.status !== "confirmed") continue;
    if (row.poolingConsent !== true) continue;
    const brandId = row.brandId?.trim();
    if (!brandId) continue;
    if (!row.matchedShowId?.trim()) continue;

    const categories = uniqueCategories(row.categories);
    if (categories.length === 0) continue;

    for (const category of categories) {
      const key = priorMapKey(category, row.placement, row.priceType);
      let group = groups.get(key);
      if (!group) {
        group = {
          category,
          placement: row.placement,
          priceType: row.priceType,
          brands: new Set(),
          records: 0,
          rates: [],
          per1k: [],
        };
        groups.set(key, group);
      }
      group.brands.add(brandId);
      group.records += 1;
      if (
        row.priceType === "cpm" &&
        row.rate != null &&
        Number.isFinite(row.rate)
      ) {
        group.rates.push(row.rate);
      }
      if (
        row.downloads != null &&
        Number.isFinite(row.downloads) &&
        row.downloads > 0 &&
        row.conversions != null &&
        Number.isFinite(row.conversions)
      ) {
        group.per1k.push((row.conversions * 1000) / row.downloads);
      }
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
      recordCount: group.records,
      medianCpm:
        group.priceType === "cpm" ? percentileCont(0.5, group.rates) : null,
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
 * Read pooled priors for these keys. Fail-soft: a missing table or a
 * query error returns an empty map. An empty key list does not query.
 */
export async function loadPooledPriors(
  keys: PooledPriorKey[]
): Promise<Map<string, PooledPrior>> {
  const wanted = new Set<string>();
  for (const key of keys) {
    const category = key.category?.trim();
    if (!category) continue;
    wanted.add(priorMapKey(category, key.placement ?? null, key.priceType ?? null));
  }
  if (wanted.size === 0) return new Map();

  try {
    const { data, error } = await supabaseAdmin
      .from("pooled_import_priors")
      .select(
        "category, placement, price_type, brand_count, record_count, median_cpm, median_conversions_per_1k_downloads"
      );
    if (error) {
      console.warn("[learning] pooled priors unavailable:", error.message);
      return new Map();
    }
    const out = new Map<string, PooledPrior>();
    for (const row of (data ?? []) as RawPriorRow[]) {
      const prior = presentPrior(row);
      if (!prior) continue;
      const mapKey = priorMapKey(prior.category, prior.placement, prior.priceType);
      if (!wanted.has(mapKey)) continue;
      out.set(mapKey, prior);
    }
    return out;
  } catch (err) {
    console.warn(
      "[learning] pooled priors unavailable:",
      err instanceof Error ? err.message : err
    );
    return new Map();
  }
}

/**
 * Rebuild the pooled table. Fail-soft. Callers schedule this; this
 * module does not.
 */
export async function refreshPooledImportPriors(): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc("refresh_pooled_import_priors");
    if (error) {
      console.warn("[learning] pooled prior refresh unavailable:", error.message);
      return null;
    }
    return typeof data === "number" && Number.isFinite(data) ? data : null;
  } catch (err) {
    console.warn(
      "[learning] pooled prior refresh unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Map key for a (category, placement, price type) group. */
export function priorMapKey(
  category: string,
  placement: string | null,
  priceType: string | null
): string {
  return `${category}\u0000${placement ?? "\u0001"}\u0000${priceType ?? "\u0001"}`;
}

/** Discovery placement (midroll) and import placement (mid-roll) share one key. */
export function toPoolPlacement(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "preroll" || key === "pre-roll") return "pre-roll";
  if (key === "midroll" || key === "mid-roll") return "mid-roll";
  if (key === "postroll" || key === "post-roll") return "post-roll";
  return value.trim();
}

/** Show price_type flat_rate and import price_type flat share one key. */
export function toPoolPriceType(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "cpm") return "cpm";
  if (key === "flat" || key === "flat_rate" || key === "fixed" || key === "fixed_rate") {
    return "flat";
  }
  return null;
}

/**
 * percentile_cont(fraction) for a list of finite numbers.
 * Position is 1 + fraction * (n - 1), then linear interpolation.
 * Nulls are omitted by the caller. An empty list returns null.
 */
export function percentileCont(fraction: number, values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) return null;
  const row = 1 + fraction * (count - 1);
  const lower = Math.floor(row);
  const upper = Math.ceil(row);
  if (lower === upper) return sorted[lower - 1];
  const weight = row - lower;
  const low = sorted[lower - 1];
  const high = sorted[upper - 1];
  return low + weight * (high - low);
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

function presentPrior(row: RawPriorRow): PooledPrior | null {
  const category = row.category?.trim();
  if (!category) return null;
  const brandCount = asNumber(row.brand_count);
  const recordCount = asNumber(row.record_count);
  if (brandCount == null || brandCount < POOL_MIN_BRANDS) return null;
  if (recordCount == null) return null;
  return {
    category,
    placement: row.placement ?? null,
    priceType: row.price_type ?? null,
    brandCount,
    recordCount,
    medianCpm: asNumber(row.median_cpm),
    medianConversionsPer1kDownloads: asNumber(row.median_conversions_per_1k_downloads),
  };
}

function asNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
