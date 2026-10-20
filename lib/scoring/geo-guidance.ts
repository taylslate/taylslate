// ============================================================
// AUDIENCE GEOGRAPHY (guidance)
//
// Country shares on the show (from a media kit) compared with a
// target market on the brief. When both exist, the share of the
// reported audience inside the target becomes an audience-fit
// signal. When the show has geography and the brief does not name
// a market we can score, the breakdown is quoted and the score
// does not move. Missing geography is silence, not a zero.
//
// Pure. Never throws.
// ============================================================

import type { AudienceGeography, CampaignPatternRow, Show, ShowDemographics } from "@/lib/data/types";
import { GEO_KEYS, type GeoKey, hasAudienceGeography } from "@/lib/shows/media-kit-geo";

const GEO_LABEL: Record<GeoKey, string> = {
  us: "US",
  uk: "UK",
  canada: "Canada",
  australia: "Australia",
};

const ALIASES: Array<{ key: GeoKey; pattern: RegExp }> = [
  { key: "us", pattern: /^(?:united states|u\.s\.a\.|u\.s\.|usa|us)$/i },
  { key: "uk", pattern: /^(?:united kingdom|great britain|britain|u\.k\.|uk)$/i },
  { key: "canada", pattern: /^(?:canada|canadian)$/i },
  { key: "australia", pattern: /^(?:australia|australian|aus)$/i },
];

export interface GeographyGuidance {
  /** 0–100 overlap, or null when geography must not move the score. */
  score: number | null;
  line: string | null;
}

export function geographyGuidance(
  show: Pick<Show, "demographics">,
  pattern: Pick<CampaignPatternRow, "product_attributes">
): GeographyGuidance {
  const shares = readShares(show.demographics);
  if (!shares) return { score: null, line: null };

  const distribution = formatShares(shares);
  const target = readTargetCountries(pattern.product_attributes);
  if (!target?.named) {
    return { score: null, line: `Audience geography: ${distribution}.` };
  }

  const known = target.keys.filter((key) => shares[key] !== undefined);
  if (known.length === 0) {
    return {
      score: null,
      line: `Audience geography: ${distribution}. The brief's target market is not in this breakdown, so geography does not change the score.`,
    };
  }

  const total = GEO_KEYS.reduce((sum, key) => sum + (shares[key] ?? 0), 0);
  if (total <= 0) return { score: null, line: `Audience geography: ${distribution}.` };

  const inTarget = known.reduce((sum, key) => sum + (shares[key] ?? 0), 0);
  const overlap = Math.round(Math.max(0, Math.min(100, (inTarget / total) * 100)));
  const market = known.map((key) => GEO_LABEL[key]).join(" and ");
  return {
    score: overlap,
    line: `Audience geography: ${distribution}. ${overlap}% of the reported audience is in the target market (${market}).`,
  };
}

function readShares(demographics: ShowDemographics | null | undefined): AudienceGeography | null {
  if (!demographics) return null;
  const raw: AudienceGeography = {};
  for (const key of GEO_KEYS) {
    const value = demographics[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      raw[key] = value;
    }
  }
  if (!hasAudienceGeography(raw)) return null;

  const values = GEO_KEYS.map((key) => raw[key]).filter((value): value is number => value !== undefined);
  // Percents are the stored form (70 = 70%). A set of values that are all
  // below 1 is a fraction breakdown (0.7 = 70%). A lone 1 stays 1%, not 100%.
  const asFractions = values.length > 0 && values.every((value) => value < 1);
  const shares: AudienceGeography = {};
  for (const key of GEO_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    const pct = asFractions ? value * 100 : value;
    shares[key] = Math.max(0, Math.min(100, pct));
  }
  return shares;
}

function formatShares(shares: AudienceGeography): string {
  return GEO_KEYS.filter((key) => shares[key] !== undefined)
    .map((key) => {
      const rounded = Math.round((shares[key] as number) * 10) / 10;
      return `${GEO_LABEL[key]} ${rounded}%`;
    })
    .join(", ");
}

/**
 * Target countries from product_attributes.target_geography, or from
 * target_audience.countries / target_audience.geography. Names we
 * don't have a show field for are dropped (they can't be scored).
 */
export function readTargetCountries(
  attrs: unknown
): { keys: GeoKey[]; named: boolean } | null {
  if (!attrs || typeof attrs !== "object") return null;
  const record = attrs as Record<string, unknown>;
  const raw = record.target_geography ?? nestedCountries(record.target_audience);
  const names = readNames(raw);
  if (names.length === 0) return null;
  const keys: GeoKey[] = [];
  for (const name of names) {
    const key = normalizeCountry(name);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return { keys, named: true };
}

function nestedCountries(target: unknown): unknown {
  if (!target || typeof target !== "object") return null;
  const record = target as Record<string, unknown>;
  return record.countries ?? record.geography ?? null;
}

function readNames(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw.split(/[,/]| and /i).map((part) => part.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

function normalizeCountry(name: string): GeoKey | null {
  const trimmed = name.trim();
  for (const alias of ALIASES) {
    if (alias.pattern.test(trimmed)) return alias.key;
  }
  return null;
}
