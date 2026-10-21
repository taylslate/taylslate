// ============================================================
// MEDIA-KIT GEOGRAPHY
//
// Pulls audience country shares out of a media kit (pasted text or
// text extracted from an upload). Writes only the four country fields
// ShowDemographics already has. A kit that doesn't name a country
// produces nothing — shares are never guessed.
//
// Pure. Never throws.
// ============================================================

import type { AudienceGeography, ShowDemographics } from "@/lib/data/types";

export const GEO_KEYS = ["us", "uk", "canada", "australia"] as const;
export type GeoKey = (typeof GEO_KEYS)[number];

const GEO_LABEL: Record<GeoKey, string> = {
  us: "US",
  uk: "UK",
  canada: "Canada",
  australia: "Australia",
};

interface CountryAlias {
  key: GeoKey;
  pattern: RegExp;
}

// Order is not precedence — pairing is by distance. Aliases are
// word-bounded so "US" does not match inside another word and
// "Australia" does not match "Australian" via a shorter token.
const COUNTRIES: CountryAlias[] = [
  { key: "us", pattern: /\b(?:united states|u\.s\.a\.|u\.s\.|usa|us)\b/gi },
  { key: "uk", pattern: /\b(?:united kingdom|great britain|britain|u\.k\.|uk)\b/gi },
  { key: "canada", pattern: /\bcanadians?\b|\bcanada\b/gi },
  { key: "australia", pattern: /\baustralians?\b|\baustralia\b|\baus\b/gi },
];

const PERCENT = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)/gi;

// Words that may sit between a country label and its percentage
// ("62% of listeners in the US"). Anything else ("35% funnier in
// the US") is a sentence, not a geography cell, and is ignored.
const BRIDGE_WORD =
  /^(?:of|in|the|listeners?|audience|from|based|located|are|is|approx|approximately|about|share|percentage|only|mostly|primarily|across|within|and)$/i;

const AGE_SLICE = /\b\d{1,2}\s*[-–]\s*\d{1,2}\b|\b\d{1,2}\s*\+/;

const PAIR_WINDOW = 48;

interface Span {
  start: number;
  end: number;
  key?: GeoKey;
  value?: number;
}

/**
 * Parse country shares from media-kit text. Returns only the countries
 * that were actually printed next to a percentage. Empty object when
 * the text has no geography breakdown.
 */
export function parseMediaKitGeography(text: string | null | undefined): AudienceGeography {
  if (!text || typeof text !== "string") return {};
  const source = text.replace(/\u00a0/g, " ");

  const countries: Span[] = [];
  for (const country of COUNTRIES) {
    country.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = country.pattern.exec(source))) {
      countries.push({
        start: match.index,
        end: match.index + match[0].length,
        key: country.key,
      });
      if (match[0].length === 0) break;
    }
  }

  const percents: Span[] = [];
  PERCENT.lastIndex = 0;
  let percentMatch: RegExpExecArray | null;
  while ((percentMatch = PERCENT.exec(source))) {
    const value = Number(percentMatch[1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    percents.push({
      start: percentMatch.index,
      end: percentMatch.index + percentMatch[0].length,
      value,
    });
  }

  interface Pair {
    country: Span;
    percent: Span;
    distance: number;
    countryBefore: boolean;
  }

  const pairs: Pair[] = [];
  for (const percent of percents) {
    for (const country of countries) {
      const countryBefore = country.end <= percent.start;
      const percentBefore = percent.end <= country.start;
      if (!countryBefore && !percentBefore) continue;
      const gapStart = countryBefore ? country.end : percent.end;
      const gapEnd = countryBefore ? percent.start : country.start;
      const gap = source.slice(gapStart, gapEnd);
      if (gap.length > PAIR_WINDOW) continue;
      if (AGE_SLICE.test(gap)) continue;
      if (!bridgeIsLabel(gap)) continue;
      const distance = gap.length;
      pairs.push({ country, percent, distance, countryBefore });
    }
  }

  // Closest pair wins. A tie prefers the label that comes before the
  // number ("US 62%" rather than the following country's label).
  pairs.sort(
    (a, b) =>
      a.distance - b.distance || Number(b.countryBefore) - Number(a.countryBefore)
  );

  const usedCountries = new Set<Span>();
  const usedPercents = new Set<Span>();
  const found: AudienceGeography = {};

  for (const pair of pairs) {
    const key = pair.country.key;
    if (!key || pair.percent.value === undefined) continue;
    if (usedCountries.has(pair.country) || usedPercents.has(pair.percent)) continue;
    if (found[key] !== undefined) continue;
    found[key] = pair.percent.value;
    usedCountries.add(pair.country);
    usedPercents.add(pair.percent);
  }

  return found;
}

export function hasAudienceGeography(
  geo: AudienceGeography | null | undefined
): geo is AudienceGeography {
  if (!geo) return false;
  return GEO_KEYS.some((key) => typeof geo[key] === "number" && Number.isFinite(geo[key]));
}

/** "US 68% · UK 8% · Canada 6%" — empty string when nothing was parsed. */
export function formatAudienceGeography(
  geo: AudienceGeography | null | undefined
): string {
  if (!hasAudienceGeography(geo)) return "";
  return GEO_KEYS.filter((key) => typeof geo[key] === "number")
    .map((key) => `${GEO_LABEL[key]} ${formatPercent(geo[key] as number)}`)
    .join(" · ");
}

/**
 * Copy parsed country shares onto a show's demographics. Age, gender,
 * and income keys are left alone.
 *
 * `replace` drops country keys the new parse doesn't have, so a
 * corrected kit doesn't leave a stale share.
 * `onlyMissing` keeps a country share the show row already has.
 */
export function mergeGeographyIntoDemographics(
  demographics: ShowDemographics | null | undefined,
  geography: AudienceGeography | null | undefined,
  options: { replace?: boolean; onlyMissing?: boolean } = {}
): ShowDemographics {
  const next: ShowDemographics = { ...(demographics ?? {}) };
  for (const key of GEO_KEYS) {
    const value = geography?.[key];
    const hasValue = typeof value === "number" && Number.isFinite(value);
    if (hasValue) {
      if (options.onlyMissing && typeof next[key] === "number") continue;
      next[key] = value as number;
    } else if (options.replace) {
      delete next[key];
    }
  }
  return next;
}

function bridgeIsLabel(gap: string): boolean {
  const cleaned = gap.replace(/[^\p{L}\p{N}\s&]/gu, " ").trim();
  if (!cleaned) return true;
  const tokens = cleaned.split(/\s+/);
  if (tokens.length > 6) return false;
  return tokens.every((token) => BRIDGE_WORD.test(token));
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`;
}
