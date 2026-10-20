// Market signals for a discovery card.
//
// Every value is read from data the caller already has: Podscan sponsor
// names, host-reported brand history, a recorded rate, or a Taylslate deal.
// A missing input is the literal "unknown". Nothing here scores, hides, or
// drops a show — the card renders the same five lines either way.

import type { CostBasis, ShowBrandHistoryEntry, ShowRateCard } from "@/lib/data/types";
import { dollarsToCents } from "./spot-cost";
import { parseExclusions } from "@/lib/utils/parse-exclusions";

export type MarketSignalId =
  | "advertisers"
  | "competitor_saturation"
  | "ad_load"
  | "pricing"
  | "renewal";

export interface MarketSignal {
  id: MarketSignalId;
  label: string;
  /** The literal "unknown" when the fact is not stored. */
  value: string;
  known: boolean;
  /** One line on why this signal matters. Present for unknown values too. */
  why: string;
}

export interface AdvertiserInput {
  name: string;
  category?: string | null;
  dealType?: "one-off" | "annual" | null;
}

/** One booked Taylslate deal (show signed, or later). Not a proposal. */
export interface RenewalDealInput {
  brandKey: string;
  brandName?: string | null;
}

export interface MarketSignalInput {
  /** Confirmed product category for this brief. Empty means no similarity claim. */
  productCategory?: string | null;
  /**
   * Named exclusions already split. Null means "use exclusionText".
   * An empty array means the brief named none.
   */
  exclusions?: string[] | null;
  exclusionText?: string | null;
  advertisers?: AdvertiserInput[] | null;
  /**
   * Host brand history was read through a verified show tie.
   * False/omitted means that source was not loaded — not that it is empty.
   */
  brandHistoryLoaded?: boolean;
  /**
   * Booked deals for this show. Null means the deal read did not run.
   * An empty array means it ran and found none.
   */
  bookedDeals?: RenewalDealInput[] | null;
  /**
   * Commercial reads on the latest sponsored episode, only when that count
   * is stored. Sponsor-name lists are not a stand-in.
   */
  commercialReadsOnLatestEpisode?: number | null;
  /** Recorded CPM dollars: rate card, brand-entered, show-stated, or a deal. */
  recordedCpms?: number[] | null;
  /** Recorded flat dollars per integration. Not a default YouTube fee. */
  recordedFlatDollars?: number[] | null;
  audienceSize?: number | null;
}

const UNKNOWN = "unknown";

const WHY: Record<MarketSignalId, string> = {
  advertisers:
    "Advertisers already on a show are who this audience is used to hearing, including anyone in this product's category.",
  competitor_saturation:
    "A named competitor already on the show can split the read and may sit inside an exclusivity window.",
  ad_load:
    "Too many ads in one episode can bury a read. This counts only when ads per episode are stored.",
  pricing:
    "A recorded rate is a number someone stated or agreed. A default CPM from audience size is not shown.",
  renewal:
    "A repeat buy or an annual deal is evidence an advertiser came back. A single one-off is not a renewal.",
};

const NAME_CAP = 5;

/** A deal the show has signed, or that has moved into delivery. */
export const BOOKED_DEAL_STATUSES = new Set([
  "show_signed",
  "delivering",
  "completed",
  "signed",
  "live",
]);

export interface MarketSignalContext {
  productCategory: string | null;
  exclusions: string[] | null;
  exclusionText: string | null;
}

/**
 * Category and exclusions for the signal pass. Structured exclusions on the
 * pattern win. Otherwise the brief's exclusion text is parsed later.
 */
export function readMarketSignalContext(input: {
  productAttributes?: Record<string, unknown> | null;
  productCategory?: string | null;
  exclusionsText?: string | null;
}): MarketSignalContext {
  const fromArg = cleanText(input.productCategory);
  const fromAttrs = cleanText(readAttr(input.productAttributes, "category"));
  const parsed = readParsedExclusions(input.productAttributes);
  return {
    productCategory: fromArg ?? fromAttrs,
    exclusions: parsed.length > 0 ? parsed : null,
    exclusionText: parsed.length > 0 ? null : cleanText(input.exclusionsText),
  };
}

export interface PricingSource {
  minBuy?: number | null;
  rateCard?: ShowRateCard | null;
  priceType?: string | null;
  placement?: "preroll" | "midroll" | "postroll" | null;
  cpmUsedCents?: number | null;
  perSpotCents?: number | null;
  costBasis?: CostBasis | null;
  isEstimate?: boolean | null;
  audienceSize?: number | null;
  /** Show-stated CPM from a tied show profile. */
  expectedCpm?: number | null;
}

/** CPMs and flats that were stated or agreed. Audience-band defaults are dropped. */
export function recordedPricing(source: PricingSource): {
  cpms: number[];
  flats: number[];
  audienceSize: number | null;
} {
  const cpms: number[] = [];
  const flats: number[] = [];
  const estimate = source.isEstimate === true;
  const basis = source.costBasis ?? null;

  if (!estimate && positive(source.cpmUsedCents) && (basis === "rate_card" || basis === "derived")) {
    cpms.push(source.cpmUsedCents! / 100);
  }
  if (
    !estimate &&
    basis === "rate_card" &&
    source.priceType === "flat_rate" &&
    positive(source.perSpotCents)
  ) {
    flats.push(source.perSpotCents! / 100);
  }

  // A discovery default writes a rate card and leaves min_buy empty.
  // min_buy is what marks an onboarded card as a number the show stated.
  const onboarded = positive(source.minBuy);
  if (onboarded && source.rateCard) {
    const key = `${source.placement ?? "midroll"}_cpm` as const;
    const cpm = source.rateCard[key];
    if (positive(cpm)) cpms.push(cpm);
    if (source.priceType === "flat_rate" && positive(source.rateCard.flat_rate)) {
      flats.push(source.rateCard.flat_rate);
    }
  }
  if (positive(source.expectedCpm)) cpms.push(source.expectedCpm!);

  return {
    cpms,
    flats,
    audienceSize: positive(source.audienceSize) ? source.audienceSize! : null,
  };
}

/** Host-reported history entries with a brand name. Junk elements are dropped. */
export function parseBrandHistory(raw: unknown): ShowBrandHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ShowBrandHistoryEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.brand_name === "string" ? row.brand_name.trim() : "";
    if (!name) continue;
    const entry: ShowBrandHistoryEntry = { brand_name: name.slice(0, 100) };
    if (typeof row.category === "string" && row.category.trim()) {
      entry.category = row.category.trim().slice(0, 80);
    }
    if (row.deal_type === "one-off" || row.deal_type === "annual") {
      entry.deal_type = row.deal_type;
    }
    out.push(entry);
  }
  return out;
}

export function computeMarketSignals(input: MarketSignalInput = {}): MarketSignal[] {
  const advertisers = mergeAdvertisers(input.advertisers ?? []);
  return [
    advertiserSignal(advertisers, input.productCategory),
    saturationSignal(advertisers, namedCompetitors(input)),
    adLoadSignal(input.commercialReadsOnLatestEpisode),
    pricingSignal(input),
    renewalSignal(input, advertisers),
  ];
}

// ---- Advertisers ----------------------------------------------------------

interface MergedAdvertiser {
  name: string;
  category: string | null;
  dealType: "one-off" | "annual" | null;
}

function advertiserSignal(
  advertisers: MergedAdvertiser[],
  productCategory: string | null | undefined
): MarketSignal {
  const base = {
    id: "advertisers" as const,
    why: WHY.advertisers,
  };
  if (advertisers.length === 0) {
    return { ...base, label: "Advertiser history", value: UNKNOWN, known: false };
  }

  const product = normCategory(productCategory ?? "");
  const similar = product
    ? advertisers.filter((row) => row.category != null && normCategory(row.category) === product)
    : [];
  const similarKeys = new Set(similar.map((row) => normName(row.name)));
  const others = advertisers.filter((row) => !similarKeys.has(normName(row.name)));

  if (similar.length > 0) {
    const head = `Similar (${cleanText(productCategory)}): ${joinNames(similar.map((row) => row.name))}`;
    const tail =
      others.length > 0
        ? `. Other recorded: ${joinNames(others.map(formatAdvertiser))}`
        : "";
    return { ...base, label: "Similar advertisers", value: `${head}${tail}`, known: true };
  }

  const categorized = advertisers.some((row) => row.category);
  return {
    ...base,
    label: categorized ? "Category history" : "Recorded advertisers",
    value: joinNames(advertisers.map(formatAdvertiser)),
    known: true,
  };
}

function formatAdvertiser(row: MergedAdvertiser): string {
  return row.category ? `${row.name} (${row.category})` : row.name;
}

function mergeAdvertisers(records: AdvertiserInput[]): MergedAdvertiser[] {
  const byKey = new Map<string, MergedAdvertiser>();
  for (const rec of records) {
    const name = rec.name?.trim() ?? "";
    const key = normName(name);
    if (!key) continue;
    const category = cleanText(rec.category);
    const dealType =
      rec.dealType === "annual" || rec.dealType === "one-off" ? rec.dealType : null;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { name, category, dealType });
      continue;
    }
    if (!existing.category && category) existing.category = category;
    if (dealType === "annual" || (existing.dealType == null && dealType)) {
      existing.dealType = dealType;
    }
  }
  return [...byKey.values()];
}

// ---- Competitor saturation ------------------------------------------------

function saturationSignal(
  advertisers: MergedAdvertiser[],
  competitors: string[]
): MarketSignal {
  const base = {
    id: "competitor_saturation" as const,
    label: "Competitor saturation",
    why: WHY.competitor_saturation,
  };
  if (competitors.length === 0 || advertisers.length === 0) {
    return { ...base, value: UNKNOWN, known: false };
  }
  const hits: string[] = [];
  for (const name of competitors) {
    const found = advertisers.some((row) => namesMatch(name, row.name));
    if (found) hits.push(name);
  }
  if (hits.length === 0) {
    return {
      ...base,
      value: "None of the named competitors appear in recorded advertisers",
      known: true,
    };
  }
  return {
    ...base,
    value: `${hits.length} of ${competitors.length} named competitors appear: ${joinNames(hits)}`,
    known: true,
  };
}

function namedCompetitors(input: MarketSignalInput): string[] {
  if (input.exclusions != null) {
    return dedupeText(input.exclusions);
  }
  if (input.exclusionText && input.exclusionText.trim()) {
    return parseExclusions(input.exclusionText);
  }
  return [];
}

// ---- Ad load --------------------------------------------------------------

function adLoadSignal(reads: number | null | undefined): MarketSignal {
  const base = {
    id: "ad_load" as const,
    label: "Ad load",
    why: WHY.ad_load,
  };
  if (typeof reads !== "number" || !Number.isInteger(reads) || reads < 0) {
    return { ...base, value: UNKNOWN, known: false };
  }
  const noun = reads === 1 ? "read" : "reads";
  return {
    ...base,
    value: `${reads} commercial ${noun} on the latest sponsored episode`,
    known: true,
  };
}

// ---- Pricing --------------------------------------------------------------

function pricingSignal(input: MarketSignalInput): MarketSignal {
  const base = {
    id: "pricing" as const,
    label: "CPM / spend",
    why: WHY.pricing,
  };
  const cpms = uniqueDollars(input.recordedCpms ?? []);
  const flats = uniqueDollars(input.recordedFlatDollars ?? []);
  if (cpms.length === 0 && flats.length === 0) {
    return { ...base, value: UNKNOWN, known: false };
  }

  const parts: string[] = [];
  if (cpms.length > 0) {
    const band = cpms.length === 1 ? formatDollars(cpms[0]) : `${formatDollars(cpms[0])}–${formatDollars(cpms[cpms.length - 1])}`;
    let line = `${band} CPM`;
    const audience = positive(input.audienceSize) ? input.audienceSize! : null;
    if (audience != null) {
      const spends = cpms.map((cpm) => dollarsToCents((audience / 1000) * cpm));
      const spend =
        spends.length === 1
          ? formatCents(spends[0])
          : `${formatCents(spends[0])}–${formatCents(spends[spends.length - 1])}`;
      line += ` · ${spend} per spot at ${Math.round(audience).toLocaleString("en-US")} downloads`;
    }
    parts.push(line);
  }
  if (flats.length > 0) {
    const band =
      flats.length === 1
        ? formatDollars(flats[0])
        : `${formatDollars(flats[0])}–${formatDollars(flats[flats.length - 1])}`;
    parts.push(`${band} flat`);
  }
  return { ...base, value: parts.join(". "), known: true };
}

// ---- Renewal --------------------------------------------------------------

function renewalSignal(
  input: MarketSignalInput,
  advertisers: MergedAdvertiser[]
): MarketSignal {
  const base = {
    id: "renewal" as const,
    label: "Renewal",
    why: WHY.renewal,
  };
  const annual = advertisers.filter((row) => row.dealType === "annual").map((row) => row.name);
  const oneOff = advertisers.some((row) => row.dealType === "one-off");
  const repeats =
    input.bookedDeals == null ? null : repeatGroups(input.bookedDeals);

  const parts: string[] = [];
  if (annual.length > 0) parts.push(`Annual on file: ${joinNames(annual)}`);
  if (repeats && repeats.length > 0) {
    parts.push(
      `Repeat deals: ${joinNames(repeats.map((row) => `${row.label} (${row.count} deals)`))}`
    );
  }
  if (parts.length > 0) {
    return { ...base, value: parts.join(". "), known: true };
  }

  if (input.bookedDeals == null) {
    if (input.brandHistoryLoaded && oneOff) {
      return { ...base, value: "Host-recorded buys are one-off", known: true };
    }
    return { ...base, value: UNKNOWN, known: false };
  }

  if (input.brandHistoryLoaded) {
    const note = oneOff ? " Host-recorded buys are one-off." : "";
    return { ...base, value: `No renewal on file.${note}`.trim(), known: true };
  }
  return { ...base, value: "No repeat Taylslate deal is on file", known: true };
}

function repeatGroups(
  deals: RenewalDealInput[]
): { label: string; count: number }[] {
  const groups = new Map<string, { name: string | null; count: number }>();
  for (const deal of deals) {
    const key = deal.brandKey?.trim() ?? "";
    if (!key) continue;
    const current = groups.get(key) ?? { name: null, count: 0 };
    current.count += 1;
    const name = cleanText(deal.brandName);
    if (!current.name && name) current.name = name;
    groups.set(key, current);
  }
  return [...groups.values()]
    .filter((group) => group.count >= 2)
    .map((group) => ({
      label: group.name ?? "An advertiser with no name on file",
      count: group.count,
    }));
}

// ---- Text helpers ---------------------------------------------------------

function joinNames(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length <= NAME_CAP) return clean.join(", ");
  return `${clean.slice(0, NAME_CAP).join(", ")} +${clean.length - NAME_CAP}`;
}

function uniqueDollars(values: number[]): number[] {
  const byCents = new Map<number, number>();
  for (const value of values) {
    if (!positive(value)) continue;
    const cents = dollarsToCents(value);
    if (!byCents.has(cents)) byCents.set(cents, cents / 100);
  }
  return [...byCents.values()].sort((a, b) => a - b);
}

function formatDollars(dollars: number): string {
  return formatCents(dollarsToCents(dollars));
}

function formatCents(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body =
    rem === 0
      ? dollars.toLocaleString("en-US")
      : `${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
  return `${cents < 0 ? "-" : ""}$${body}`;
}

export function normName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normCategory(value: string): string {
  return normName(value);
}

function namesMatch(a: string, b: string): boolean {
  const left = normName(a);
  const right = normName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 4) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${escaped}(?:$| )`).test(longer);
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dedupeText(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function readAttr(
  attrs: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!attrs) return null;
  const value = attrs[key];
  return typeof value === "string" ? value : null;
}

function readParsedExclusions(attrs: Record<string, unknown> | null | undefined): string[] {
  if (!attrs) return [];
  const interpretation = asRecord(attrs.interpretation);
  const fromPattern = asRecord(interpretation?.campaign_pattern);
  if (fromPattern && Array.isArray(fromPattern.exclusions_parsed)) {
    return dedupeText(fromPattern.exclusions_parsed.filter((v): v is string => typeof v === "string"));
  }
  const brief = asRecord(attrs.brief_context);
  if (brief && Array.isArray(brief.exclusions_parsed)) {
    return dedupeText(brief.exclusions_parsed.filter((v): v is string => typeof v === "string"));
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
