// Load the facts a discovery card's market signals can state.
//
// Reads only rows that already exist: show_profiles.brand_history (through
// the same verified ties as media-kit geography), shows.current_sponsors /
// past_sponsors, show_sponsors, and deals. A failed read leaves that fact
// unknown. The returned map has one entry per requested show — nothing is
// dropped because a signal is missing or unfavorable.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CostBasis, ShowBrandHistoryEntry, ShowRateCard } from "@/lib/data/types";
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
  podscanId: string | null;
  userId: string | null;
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
  showProfilesByPodscanIds(ids: string[]): Promise<ProfileRow[] | null>;
  showProfilesByIds(ids: string[]): Promise<ProfileRow[] | null>;
  showProfileByUserId(userId: string): Promise<ProfileRow | null>;
  profileIdByEmail(email: string): Promise<string | null>;
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

  const podscanIds = unique(shows.map((show) => clean(show.podscanId)));
  const showIds = unique(shows.map((show) => (isUuid(show.showId) ? show.showId : null)));

  const [profilesByPodscan, deals, sponsors] = await Promise.all([
    podscanIds.length > 0 ? deps.showProfilesByPodscanIds(podscanIds) : Promise.resolve([]),
    showIds.length > 0 ? deps.dealsForShowIds(showIds) : Promise.resolve([]),
    showIds.length > 0 ? deps.showSponsorsForShowIds(showIds) : Promise.resolve([]),
  ]);

  const profilesById = new Map<string, ProfileRow>();
  if (profilesByPodscan) {
    for (const profile of profilesByPodscan) {
      profilesById.set(profile.id, profile);
      const podscanId = clean(profile.podscanId);
      if (!podscanId) continue;
      for (const show of shows) {
        if (clean(show.podscanId) !== podscanId) continue;
        attachProfile(facts.get(show.showId), profile);
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
    const profileIds = unique(
      deals.map((deal) => deal.showProfileId).filter((id) => id && !profilesById.has(id))
    );
    if (profileIds.length > 0) {
      const linked = await deps.showProfilesByIds(profileIds);
      if (linked) {
        for (const profile of linked) profilesById.set(profile.id, profile);
      }
    }
    for (const deal of deals) {
      const profile = deal.showProfileId ? profilesById.get(deal.showProfileId) : undefined;
      if (!profile) continue;
      attachProfile(facts.get(deal.showId), profile);
    }
  }

  if (sponsors) {
    for (const sponsor of sponsors) {
      const bag = facts.get(sponsor.showId);
      const name = clean(sponsor.brandName);
      if (bag && name) bag.extraSponsorNames.push(name);
    }
  }

  await attachOwnerProfiles(shows, facts, deps);

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

async function attachOwnerProfiles(
  shows: MarketSignalShowRef[],
  facts: Map<string, ShowFacts>,
  deps: MarketSignalDeps
): Promise<void> {
  const owners = shows.filter(
    (show) =>
      isUuid(show.showId) &&
      Array.isArray(show.dataSources) &&
      show.dataSources.includes("show_owner") &&
      clean(show.contactEmail)
  );
  await Promise.all(
    owners.map(async (show) => {
      const email = clean(show.contactEmail);
      if (!email) return;
      const userId = await deps.profileIdByEmail(email);
      if (!userId) return;
      const profile = await deps.showProfileByUserId(userId);
      if (!profile) return;
      attachProfile(facts.get(show.showId), profile);
    })
  );
}

function isBooked(deal: DealRow): boolean {
  return BOOKED_DEAL_STATUSES.has(deal.status);
}

function isCancelled(status: string): boolean {
  return status === "cancelled";
}

const defaultDeps: MarketSignalDeps = {
  async showProfilesByPodscanIds(ids) {
    return readProfiles("podscan_id", ids);
  },
  async showProfilesByIds(ids) {
    return readProfiles("id", ids);
  },
  async showProfileByUserId(userId) {
    const { data, error } = await supabaseAdmin
      .from("show_profiles")
      .select("id, user_id, podscan_id, brand_history, expected_cpm")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[market-signals] owner profile read failed:", error.message);
      return null;
    }
    return data ? toProfile(data as RawProfile) : null;
  },
  async profileIdByEmail(email) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .ilike("email", escapeIlike(email))
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { id?: string; email?: string };
    if (!row.id || !row.email) return null;
    if (row.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
    return row.id;
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
  user_id?: string | null;
  podscan_id?: string | null;
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

async function readProfiles(column: "podscan_id" | "id", ids: string[]): Promise<ProfileRow[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("show_profiles")
    .select("id, user_id, podscan_id, brand_history, expected_cpm")
    .in(column, ids);
  if (error) {
    console.warn(`[market-signals] show_profiles by ${column} failed:`, error.message);
    return null;
  }
  return (data ?? []).map((row) => toProfile(row as RawProfile)).filter((row) => row.id);
}

function toProfile(row: RawProfile): ProfileRow {
  return {
    id: row.id ?? "",
    podscanId: row.podscan_id ?? null,
    userId: row.user_id ?? null,
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

function unique(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
