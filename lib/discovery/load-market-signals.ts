// Load the facts a discovery card's market signals can state.
//
// Host-reported brand history and expected CPM come from show_profiles only
// through getVerifiedProfileTies: a deal link, or a show_owner row whose
// contact email matches the profile owner. show_profiles.podscan_id is
// user-writable and is not a tie. Catalog columns on shows (podscan_id,
// current_sponsors, past_sponsors) are read as stored. A failed read leaves
// that fact unknown. The returned map has one entry per requested show.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CostBasis, ShowBrandHistoryEntry, ShowRateCard } from "@/lib/data/types";
import {
  getVerifiedProfileTies,
  type ShowGeoIdentity,
  type VerifiedProfileTie,
} from "@/lib/shows/apply-geography";
import type { TieredShow } from "./tiered-universe";
import {
  BOOKED_DEAL_STATUSES,
  computeMarketSignals,
  parseBrandHistory,
  recordedPricing,
  type AdvertiserInput,
  type MarketSignal,
  type MarketSignalContext,
  type RenewalDealInput,
} from "./market-signals";

export interface MarketSignalShowRef {
  showId: string;
  podscanId?: string | null;
  contactEmail?: string | null;
  dataSources?: string[] | null;
  currentSponsors?: string[] | null;
  pastSponsors?: string[] | null;
  audienceSize?: number | null;
  priceType?: string | null;
  minBuy?: number | null;
  rateCard?: ShowRateCard | null;
  placement?: "preroll" | "midroll" | "postroll" | null;
  cpmUsedCents?: number | null;
  perSpotCents?: number | null;
  costBasis?: CostBasis | null;
  isEstimate?: boolean | null;
}

interface ProfileRow {
  id: string;
  brandHistory: unknown;
  expectedCpm: number | null;
}

interface DealRow {
  showId: string;
  showProfileId: string | null;
  brandId: string | null;
  brandProfileId: string | null;
  status: string;
  priceType: string | null;
  cpmRate: number | null;
  agreedCpm: number | null;
  netPerEpisode: number | null;
  grossPerEpisode: number | null;
}

interface SponsorRow {
  showId: string;
  brandName: string;
}

export interface MarketSignalDeps {
  /** Deal link or show_owner email. A podscan id match is not a tie. */
  lookupProfileTies(identities: ShowGeoIdentity[]): Promise<VerifiedProfileTie[] | null>;
  showProfilesByIds(ids: string[]): Promise<ProfileRow[] | null>;
  dealsForShowIds(ids: string[]): Promise<DealRow[] | null>;
  showSponsorsForShowIds(ids: string[]): Promise<SponsorRow[] | null>;
  brandNamesByProfileIds(ids: string[]): Promise<Map<string, string> | null>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function showRefFromTiered(entry: TieredShow): MarketSignalShowRef {
  const show = entry.show;
  return {
    showId: entry.showId,
    podscanId: show?.podscan_id ?? null,
    contactEmail: show?.contact?.email ?? null,
    dataSources: show?.data_sources ?? null,
    currentSponsors: show?.current_sponsors ?? null,
    pastSponsors: show?.past_sponsors ?? null,
    audienceSize: show?.audience_size ?? null,
    priceType: show?.price_type ?? null,
    minBuy: show?.min_buy ?? null,
    rateCard: show?.rate_card ?? null,
    placement: entry.placement,
    cpmUsedCents: entry.cpmUsedCents,
    perSpotCents: entry.perSpotCents,
    costBasis: entry.costBasis,
    isEstimate: entry.isEstimate,
  };
}

export async function loadMarketSignalsForShows(
  shows: MarketSignalShowRef[],
  context: MarketSignalContext,
  deps: MarketSignalDeps = defaultDeps
): Promise<Record<string, MarketSignal[]>> {
  try {
    return await loadInner(shows, context, deps);
  } catch (err) {
    console.warn(
      "[market-signals] load failed:",
      err instanceof Error ? err.message : err
    );
    const fallback: Record<string, MarketSignal[]> = {};
    for (const show of shows) fallback[show.showId] = signalsFor(show, context, emptyFacts());
    return fallback;
  }
}

interface ShowFacts {
  historyLoaded: boolean;
  history: ShowBrandHistoryEntry[];
  expectedCpms: number[];
  extraSponsorNames: string[];
  deals: DealRow[] | null;
  brandNames: Map<string, string>;
}

function emptyFacts(): ShowFacts {
  return {
    historyLoaded: false,
    history: [],
    expectedCpms: [],
    extraSponsorNames: [],
    deals: null,
    brandNames: new Map(),
  };
}

async function loadInner(
  shows: MarketSignalShowRef[],
  context: MarketSignalContext,
  deps: MarketSignalDeps
): Promise<Record<string, MarketSignal[]>> {
  const facts = new Map<string, ShowFacts>();
  for (const show of shows) facts.set(show.showId, emptyFacts());

  const showIds = unique(shows.map((show) => (isUuid(show.showId) ? show.showId : null)));
  const identities = shows.map(identityFor);

  const [ties, deals, sponsors] = await Promise.all([
    deps.lookupProfileTies(identities),
    showIds.length > 0 ? deps.dealsForShowIds(showIds) : Promise.resolve([]),
    showIds.length > 0 ? deps.showSponsorsForShowIds(showIds) : Promise.resolve([]),
  ]);

  if (ties && ties.length > 0) {
    const profiles = await deps.showProfilesByIds(unique(ties.map((tie) => tie.profileId)));
    const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    if (profiles) {
      for (const tie of ties) {
        const profile = byId.get(tie.profileId);
        if (profile) attachProfile(facts.get(tie.showId), profile);
      }
    }
  }

  if (deals) {
    for (const show of shows) {
      const bag = facts.get(show.showId);
      if (!bag) continue;
      // A non-uuid discovery id cannot have deal rows. An empty list means
      // the read ran, which is different from a failed read (null).
      bag.deals = deals.filter((deal) => deal.showId === show.showId);
    }
  }

  if (sponsors) {
    for (const sponsor of sponsors) {
      const bag = facts.get(sponsor.showId);
      const name = clean(sponsor.brandName);
      if (bag && name) bag.extraSponsorNames.push(name);
    }
  }

  const brandProfileIds = unique(
    [...facts.values()].flatMap((bag) =>
      (bag.deals ?? []).map((deal) => deal.brandProfileId)
    )
  );
  const brandNames =
    brandProfileIds.length > 0 ? await deps.brandNamesByProfileIds(brandProfileIds) : new Map();
  if (brandNames) {
    for (const bag of facts.values()) bag.brandNames = brandNames;
  }

  const out: Record<string, MarketSignal[]> = {};
  for (const show of shows) {
    out[show.showId] = signalsFor(show, context, facts.get(show.showId) ?? emptyFacts());
  }
  return out;
}

function signalsFor(
  show: MarketSignalShowRef,
  context: MarketSignalContext,
  facts: ShowFacts
): MarketSignal[] {
  const advertisers: AdvertiserInput[] = [];
  for (const entry of facts.history) {
    advertisers.push({
      name: entry.brand_name,
      category: entry.category ?? null,
      dealType: entry.deal_type ?? null,
    });
  }
  for (const name of [...(show.currentSponsors ?? []), ...(show.pastSponsors ?? []), ...facts.extraSponsorNames]) {
    if (name && name.trim()) advertisers.push({ name });
  }

  const pricing = recordedPricing({
    minBuy: show.minBuy,
    rateCard: show.rateCard,
    priceType: show.priceType,
    placement: show.placement,
    cpmUsedCents: show.cpmUsedCents,
    perSpotCents: show.perSpotCents,
    costBasis: show.costBasis,
    isEstimate: show.isEstimate,
    audienceSize: show.audienceSize,
    expectedCpm: facts.expectedCpms[0] ?? null,
  });
  for (const extra of facts.expectedCpms.slice(1)) pricing.cpms.push(extra);

  const bookedDeals: RenewalDealInput[] | null =
    facts.deals == null
      ? null
      : facts.deals.filter(isBooked).map((deal) => ({
          brandKey: deal.brandId || deal.brandProfileId || "",
          brandName: deal.brandProfileId
            ? facts.brandNames.get(deal.brandProfileId) ?? null
            : null,
        }));

  if (facts.deals) {
    for (const deal of facts.deals) {
      if (isCancelled(deal.status)) continue;
      if (deal.priceType === "flat_rate") {
        const flat = firstPositive(deal.netPerEpisode, deal.grossPerEpisode);
        if (flat != null) pricing.flats.push(flat);
        continue;
      }
      const cpm = firstPositive(deal.agreedCpm, deal.cpmRate);
      if (cpm != null) pricing.cpms.push(cpm);
    }
  }

  return computeMarketSignals({
    productCategory: context.productCategory,
    exclusions: context.exclusions,
    exclusionText: context.exclusionText,
    advertisers,
    brandHistoryLoaded: facts.historyLoaded,
    bookedDeals,
    recordedCpms: pricing.cpms,
    recordedFlatDollars: pricing.flats,
    audienceSize: pricing.audienceSize,
  });
}

function attachProfile(bag: ShowFacts | undefined, profile: ProfileRow): void {
  if (!bag) return;
  bag.historyLoaded = true;
  bag.history.push(...parseBrandHistory(profile.brandHistory));
  if (profile.expectedCpm != null && profile.expectedCpm > 0) {
    bag.expectedCpms.push(profile.expectedCpm);
  }
}

function identityFor(show: MarketSignalShowRef): ShowGeoIdentity {
  return {
    showId: isUuid(show.showId) ? show.showId : undefined,
    contactEmail: clean(show.contactEmail) ?? undefined,
    dataSources: show.dataSources ?? undefined,
  };
}

function isBooked(deal: DealRow): boolean {
  return BOOKED_DEAL_STATUSES.has(deal.status);
}

function isCancelled(status: string): boolean {
  return status === "cancelled";
}

const defaultDeps: MarketSignalDeps = {
  lookupProfileTies: getVerifiedProfileTies,
  async showProfilesByIds(ids) {
    return readProfiles(ids);
  },
  async dealsForShowIds(ids) {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select(
        "show_id, show_profile_id, brand_id, brand_profile_id, status, price_type, cpm_rate, agreed_cpm, net_per_episode, gross_per_episode"
      )
      .in("show_id", ids);
    if (error) {
      console.warn("[market-signals] deals read failed:", error.message);
      return null;
    }
    return (data ?? []).map((row) => toDeal(row as RawDeal));
  },
  async showSponsorsForShowIds(ids) {
    const { data, error } = await supabaseAdmin
      .from("show_sponsors")
      .select("show_id, brand_name")
      .in("show_id", ids);
    if (error) {
      console.warn("[market-signals] show_sponsors read failed:", error.message);
      return null;
    }
    return (data ?? []).map((row) => {
      const raw = row as { show_id?: string; brand_name?: string };
      return { showId: raw.show_id ?? "", brandName: raw.brand_name ?? "" };
    });
  },
  async brandNamesByProfileIds(ids) {
    const { data, error } = await supabaseAdmin
      .from("brand_profiles")
      .select("id, brand_name")
      .in("id", ids);
    if (error) {
      console.warn("[market-signals] brand name read failed:", error.message);
      return null;
    }
    const map = new Map<string, string>();
    for (const row of data ?? []) {
      const raw = row as { id?: string; brand_name?: string | null };
      if (raw.id && raw.brand_name && raw.brand_name.trim()) {
        map.set(raw.id, raw.brand_name.trim());
      }
    }
    return map;
  },
};

interface RawProfile {
  id?: string;
  brand_history?: unknown;
  expected_cpm?: number | string | null;
}

interface RawDeal {
  show_id?: string;
  show_profile_id?: string | null;
  brand_id?: string | null;
  brand_profile_id?: string | null;
  status?: string;
  price_type?: string | null;
  cpm_rate?: number | string | null;
  agreed_cpm?: number | string | null;
  net_per_episode?: number | string | null;
  gross_per_episode?: number | string | null;
}

async function readProfiles(ids: string[]): Promise<ProfileRow[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("show_profiles")
    .select("id, brand_history, expected_cpm")
    .in("id", ids);
  if (error) {
    console.warn("[market-signals] show_profiles read failed:", error.message);
    return null;
  }
  return (data ?? []).map((row) => toProfile(row as RawProfile)).filter((row) => row.id);
}

function toProfile(row: RawProfile): ProfileRow {
  return {
    id: row.id ?? "",
    brandHistory: row.brand_history,
    expectedCpm: asMoney(row.expected_cpm),
  };
}

function toDeal(row: RawDeal): DealRow {
  return {
    showId: row.show_id ?? "",
    showProfileId: row.show_profile_id ?? null,
    brandId: row.brand_id ?? null,
    brandProfileId: row.brand_profile_id ?? null,
    status: row.status ?? "",
    priceType: row.price_type ?? null,
    cpmRate: asMoney(row.cpm_rate),
    agreedCpm: asMoney(row.agreed_cpm),
    netPerEpisode: asMoney(row.net_per_episode),
    grossPerEpisode: asMoney(row.gross_per_episode),
  };
}

function asMoney(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstPositive(...values: Array<number | null>): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
