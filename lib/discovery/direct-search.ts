// Direct show search for the media plan.
// Catalog rows come from getShowsFiltered. Podscan name search is added
// beside them. The plan write touches scored_shows, selected_show_ids,
// and updated_at only.

import type { Campaign, ScoredShowRecord, Show } from "@/lib/data/types";
import {
  createShow,
  getShowsFiltered,
  getAuthenticatedUser,
  getCampaignById,
  getUserProfile,
} from "@/lib/data/queries";
import { transformShow } from "@/lib/data/show-transform";
import { podscanPodcastToShow } from "@/lib/discovery/format-discovered-show";
import type { PodscanPodcast as DiscoveryPodcast } from "@/lib/enrichment/podscan";
import { isBrandSide } from "@/lib/nav/items";
import { getPodscanClientSafe } from "@/lib/podscan/client";
import { searchPodcasts } from "@/lib/podscan/search";
import type { PodscanPodcast } from "@/lib/podscan/types";
import { fullShowIdsForCaller, projectShows } from "@/lib/shows/public-fields";
import { createClient } from "@/lib/supabase/server";

export const DIRECT_SEARCH_LIMIT = 10;
export const DIRECT_SEARCH_MIN = 2;
export const DIRECT_SEARCH_MAX = 100;
export const PLAN_SHOW_CAP = 50;

export const SEARCH_FAILED = "Search failed. Try again.";
export const QUERY_INVALID = "Enter 2 to 100 characters.";
export const PLAN_CONFLICT = "The plan changed. Reload and try again.";
export const PLAN_FULL = "The plan is full.";
export const SHOW_NOT_FOUND = "Show not found.";
export const BAD_KEY = "That show key is not valid.";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PODSCAN_ID = /^pd_[A-Za-z0-9]{1,40}$/;
const SHOW_KEY =
  /^show:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PODSCAN_KEY = /^podscan:(pd_[A-Za-z0-9]{1,40})$/;

export interface DirectSearchHit {
  key: string;
  name: string;
  platform: "podcast" | "youtube";
  audienceSize: number;
  categories: string[];
  imageUrl: string | null;
  origin: "taylslate" | "podscan";
}

export interface DirectSearchResponse {
  results: DirectSearchHit[];
  podscanAvailable: boolean;
}

export type PlanAccess =
  | { ok: true; userId: string; campaign: Campaign }
  | { ok: false; status: 401 | 403 | 404 | 500; error: string };

export type AddShowResult =
  | { ok: true; showId: string; alreadyInPlan: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string };

type ShowKey =
  | { ok: true; kind: "show"; id: string }
  | { ok: true; kind: "podscan"; id: string }
  | { ok: false };

// Trim, cap at 100, then escape LIKE wildcards. Same rules as
// sanitizeShowSearch. Under 2 characters after the trim returns "".
export function sanitizeDirectSearch(raw: string): string {
  const trimmed = raw.trim().slice(0, DIRECT_SEARCH_MAX);
  if (trimmed.length < DIRECT_SEARCH_MIN) return "";
  return trimmed.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function directQueryText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < DIRECT_SEARCH_MIN || trimmed.length > DIRECT_SEARCH_MAX) {
    return null;
  }
  return trimmed;
}

export function parseShowKey(raw: unknown): ShowKey {
  if (typeof raw !== "string") return { ok: false };
  const show = SHOW_KEY.exec(raw);
  if (show?.[1]) return { ok: true, kind: "show", id: show[1].toLowerCase() };
  const podscan = PODSCAN_KEY.exec(raw);
  if (podscan?.[1]) return { ok: true, kind: "podscan", id: podscan[1] };
  return { ok: false };
}

export async function loadOwnedCampaign(campaignId: string): Promise<PlanAccess> {
  let user: { id: string } | null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!user?.id) return { ok: false, status: 401, error: "Unauthorized" };

  let profile: { role?: string } | null;
  try {
    profile = await getUserProfile(user.id);
  } catch {
    return { ok: false, status: 500, error: SEARCH_FAILED };
  }
  if (!profile || !isBrandSide(profile.role as "brand")) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (!UUID.test(campaignId)) {
    return { ok: false, status: 404, error: "Not found." };
  }

  let campaign: Campaign | null;
  try {
    campaign = await getCampaignById(campaignId);
  } catch {
    return { ok: false, status: 500, error: SEARCH_FAILED };
  }
  if (!campaign || campaign.user_id !== user.id) {
    return { ok: false, status: 404, error: "Not found." };
  }
  return { ok: true, userId: user.id, campaign };
}

export async function searchShowsByName(
  userId: string,
  rawQuery: string
): Promise<DirectSearchResponse> {
  const text = directQueryText(rawQuery);
  const search = sanitizeDirectSearch(rawQuery);
  if (!text || !search) throw new Error(SEARCH_FAILED);

  const catalogPromise = getShowsFiltered({ search, limit: DIRECT_SEARCH_LIMIT }).catch(
    () => {
      console.warn("[direct-search] catalog");
      throw new Error(SEARCH_FAILED);
    }
  );
  const podscanPromise = loadPodscanByName(text);
  const [catalog, podscan] = await Promise.all([catalogPromise, podscanPromise]);

  const catalogIds = new Set(
    catalog
      .map((show) => show.podscan_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const fullIds = await fullShowIdsForCaller(
    userId,
    catalog.map((show) => ({
      id: show.id,
      contact: show.contact,
      data_sources: show.data_sources,
    }))
  );
  const projected = projectShows(catalog, fullIds);
  const results: DirectSearchHit[] = [];
  for (const row of projected) {
    const hit = catalogHit(row);
    if (hit) results.push(hit);
  }
  if (podscan.available) {
    for (const podcast of podscan.podcasts) {
      if (catalogIds.has(podcast.podcast_id)) continue;
      const hit = podscanHit(podcast);
      if (hit) results.push(hit);
    }
  }
  return { results, podscanAvailable: podscan.available };
}

export function toSearchedScoredShowRecord(show: Show): ScoredShowRecord {
  const audience = finiteNumber(show.audience_size);
  const onboarded = hasOnboardedRateCard(show);
  return {
    podcastId: show.id,
    name: show.name,
    description: "",
    imageUrl: nonEmpty(show.image_url) ?? null,
    websiteUrl: null,
    rssUrl: null,
    categories: stringList(show.categories).slice(0, 5),
    publisherName: nonEmpty(show.network) ?? null,
    language: null,
    episodeCount: 0,
    lastPostedAt: null,
    contactEmail: null,
    audienceSize: audience,
    prsScore: null,
    compositeScore: 0,
    dimensionScores: {
      audienceFit: null,
      adEngagement: null,
      sponsorRetention: null,
      reach: 0,
    },
    estimatedCpm: baseCpm(show, audience),
    demographics: null,
    sponsorCount: 0,
    adEngagementRate: null,
    brandSafety: null,
    source: "search",
    costIsEstimate: !onboarded,
    audienceIsEstimate: audienceFromPodscan(show, onboarded),
  };
}

export async function appendShowToPlan(
  campaign: { id: string; user_id: string },
  record: ScoredShowRecord
): Promise<AddShowResult> {
  const supabase = await createClient();
  const read = await supabase
    .from("campaigns")
    .select("scored_shows, selected_show_ids, updated_at")
    .eq("id", campaign.id)
    .eq("user_id", campaign.user_id)
    .maybeSingle();

  if (read.error) {
    console.error("[direct-search] plan read", read.error.code ?? "error");
    return { ok: false, status: 500, error: SEARCH_FAILED };
  }
  const row = read.data as {
    scored_shows?: unknown;
    selected_show_ids?: unknown;
    updated_at?: unknown;
  } | null;
  if (!row || typeof row.updated_at !== "string" || !row.updated_at) {
    return { ok: false, status: 409, error: PLAN_CONFLICT };
  }

  const selected = stringList(row.selected_show_ids);
  const showId = record.podcastId;
  if (selected.some((id) => id.toLowerCase() === showId.toLowerCase())) {
    return { ok: true, showId, alreadyInPlan: true };
  }
  if (selected.length >= PLAN_SHOW_CAP) {
    return { ok: false, status: 409, error: PLAN_FULL };
  }

  const scored = asRecords(row.scored_shows);
  const index = scored.findIndex((item) => item.podcastId.toLowerCase() === showId.toLowerCase());
  const nextScored = [...scored];
  if (index >= 0) nextScored[index] = record;
  else nextScored.push(record);
  const nextIds = [...selected, showId];
  const updatedAt = new Date().toISOString();

  const wrote = await supabase
    .from("campaigns")
    .update({
      scored_shows: nextScored,
      selected_show_ids: nextIds,
      updated_at: updatedAt,
    })
    .eq("id", campaign.id)
    .eq("user_id", campaign.user_id)
    .eq("updated_at", row.updated_at)
    .select("id");

  if (wrote.error) {
    console.error("[direct-search] plan update", wrote.error.code ?? "error");
    return { ok: false, status: 500, error: SEARCH_FAILED };
  }
  if (!Array.isArray(wrote.data) || wrote.data.length === 0) {
    return { ok: false, status: 409, error: PLAN_CONFLICT };
  }
  return { ok: true, showId, alreadyInPlan: false };
}

export async function addShowFromSearch(
  campaign: { id: string; user_id: string },
  rawKey: unknown
): Promise<AddShowResult> {
  const key = parseShowKey(rawKey);
  if (!key.ok) return { ok: false, status: 400, error: BAD_KEY };

  try {
    if (key.kind === "show") {
      const show = await findDiscoverableShow({ id: key.id });
      if (!show) return { ok: false, status: 404, error: SHOW_NOT_FOUND };
      return appendShowToPlan(campaign, toSearchedScoredShowRecord(show));
    }

    const existing = await findDiscoverableShow({ podscanId: key.id });
    if (existing) {
      return appendShowToPlan(campaign, toSearchedScoredShowRecord(existing));
    }

    const room = await planHasRoom(campaign);
    if (!room.ok) return room;

    const podcast = await fetchPodscanPodcast(key.id);
    if (!podcast) return { ok: false, status: 404, error: SHOW_NOT_FOUND };
    const saved = await persistPodscanShow(podcast);
    if (!saved) return { ok: false, status: 500, error: SEARCH_FAILED };
    if (saved.is_discoverable === false) {
      return { ok: false, status: 404, error: SHOW_NOT_FOUND };
    }
    return appendShowToPlan(campaign, toSearchedScoredShowRecord(saved));
  } catch {
    return { ok: false, status: 500, error: SEARCH_FAILED };
  }
}

async function planHasRoom(campaign: {
  id: string;
  user_id: string;
}): Promise<AddShowResult | { ok: true }> {
  const supabase = await createClient();
  const read = await supabase
    .from("campaigns")
    .select("selected_show_ids, updated_at")
    .eq("id", campaign.id)
    .eq("user_id", campaign.user_id)
    .maybeSingle();
  if (read.error) {
    console.error("[direct-search] plan room", read.error.code ?? "error");
    return { ok: false, status: 500, error: SEARCH_FAILED };
  }
  const row = read.data as { selected_show_ids?: unknown } | null;
  if (!row) return { ok: false, status: 409, error: PLAN_CONFLICT };
  if (stringList(row.selected_show_ids).length >= PLAN_SHOW_CAP) {
    return { ok: false, status: 409, error: PLAN_FULL };
  }
  return { ok: true };
}

async function findDiscoverableShow(filter: {
  id?: string;
  podscanId?: string;
}): Promise<Show | null> {
  const supabase = await createClient();
  let query = supabase.from("shows").select("*").eq("is_discoverable", true);
  if (filter.id) query = query.eq("id", filter.id);
  if (filter.podscanId) query = query.eq("podscan_id", filter.podscanId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[direct-search] show read", error.code ?? "error");
    throw new Error(SEARCH_FAILED);
  }
  if (!data || typeof data !== "object") return null;
  const show = transformShow(data as Record<string, unknown>);
  if (show.is_discoverable === false) return null;
  if (!UUID.test(show.id)) return null;
  return show;
}

async function persistPodscanShow(podcast: PodscanPodcast): Promise<Show | null> {
  const draft = podscanPodcastToShow(toDiscoveryPodcast(podcast));
  const saved = await createShow({
    name: draft.name,
    platform: draft.platform,
    description: draft.description,
    image_url: draft.image_url,
    categories: draft.categories ?? [],
    audience_interests: draft.audience_interests ?? [],
    tags: draft.tags ?? [],
    network: draft.network,
    contact: draft.contact,
    audience_size: draft.audience_size,
    demographics: draft.demographics,
    audience_purchase_power: draft.audience_purchase_power,
    rate_card: draft.rate_card,
    price_type: draft.price_type,
    ad_formats: draft.ad_formats,
    current_sponsors: draft.current_sponsors ?? [],
    podscan_id: draft.podscan_id,
    apple_id: draft.apple_id,
    spotify_id: draft.spotify_id,
    youtube_channel_id: draft.youtube_channel_id,
    rss_url: draft.rss_url,
    surfaces: draft.surfaces,
    medium_priors: draft.medium_priors,
    data_sources: ["direct_search"],
    is_claimed: false,
    is_verified: false,
  });
  return saved;
}

async function fetchPodscanPodcast(podcastId: string): Promise<PodscanPodcast | null> {
  const client = getPodscanClientSafe();
  if (!client) return null;
  try {
    const body = await client.get<unknown>(`/podcasts/${podcastId}`);
    const direct = podcastFromBody(body, podcastId);
    if (direct) return direct;
  } catch (err) {
    if (!podscanEndpointMissing(err)) return null;
  }
  try {
    const found = await searchPodcasts(client, {
      query: podcastId,
      searchFields: "name",
      perPage: DIRECT_SEARCH_LIMIT,
    });
    return (found.podcasts ?? []).find((row) => row.podcast_id === podcastId) ?? null;
  } catch {
    return null;
  }
}

async function loadPodscanByName(query: string): Promise<{
  available: boolean;
  podcasts: PodscanPodcast[];
}> {
  const client = getPodscanClientSafe();
  if (!client) return { available: false, podcasts: [] };
  try {
    const found = await searchPodcasts(client, {
      query,
      searchFields: "name",
      perPage: DIRECT_SEARCH_LIMIT,
    });
    return { available: true, podcasts: found.podcasts ?? [] };
  } catch {
    console.warn("[direct-search] podscan");
    return { available: false, podcasts: [] };
  }
}

// format-discovered-show types the enrichment client. Search uses lib/podscan.
// Keep the fields podscanPodcastToShow reads, and drop nulls it does not accept.
function toDiscoveryPodcast(podcast: PodscanPodcast): DiscoveryPodcast {
  return {
    podcast_id: podcast.podcast_id,
    podcast_name: podcast.podcast_name,
    podcast_description: podcast.podcast_description,
    podcast_image_url: podcast.podcast_image_url ?? undefined,
    podcast_categories: (podcast.podcast_categories ?? []).map((category) =>
      typeof category === "string" ? category : category.category_name
    ),
    publisher_name: podcast.publisher_name,
    rss_url: podcast.rss_url,
    reach: {
      audience_size: podcast.reach?.audience_size ?? undefined,
      email: podcast.reach?.email ?? undefined,
      website: podcast.reach?.website ?? undefined,
    },
  };
}

function catalogHit(row: unknown): DirectSearchHit | null {
  if (!row || typeof row !== "object") return null;
  const show = row as Record<string, unknown>;
  const id = typeof show.id === "string" ? show.id.toLowerCase() : "";
  const name = nonEmpty(show.name);
  if (!UUID.test(id) || !name) return null;
  return {
    key: `show:${id}`,
    name,
    platform: show.platform === "youtube" ? "youtube" : "podcast",
    audienceSize: finiteNumber(show.audience_size),
    categories: stringList(show.categories).slice(0, 5),
    imageUrl: nonEmpty(show.image_url) ?? null,
    origin: "taylslate",
  };
}

function podscanHit(podcast: PodscanPodcast): DirectSearchHit | null {
  if (!PODSCAN_ID.test(podcast.podcast_id ?? "")) return null;
  const name = nonEmpty(decodeHtml(podcast.podcast_name ?? ""));
  if (!name) return null;
  return {
    key: `podscan:${podcast.podcast_id}`,
    name,
    platform: "podcast",
    audienceSize: finiteNumber(podcast.reach?.audience_size),
    categories: podscanCategories(podcast).slice(0, 5),
    imageUrl: nonEmpty(podcast.podcast_image_url) ?? null,
    origin: "podscan",
  };
}

function podscanCategories(podcast: PodscanPodcast): string[] {
  const out: string[] = [];
  for (const category of podcast.podcast_categories ?? []) {
    if (typeof category === "string") {
      const name = category.trim();
      if (name) out.push(name);
      continue;
    }
    if (category && typeof category === "object" && "category_name" in category) {
      const name = nonEmpty(category.category_name);
      if (name) out.push(name);
    }
  }
  return out;
}

function podcastFromBody(body: unknown, id: string): PodscanPodcast | null {
  const record = asPodcast(body) ?? asPodcast(nestedPodcast(body));
  if (!record || record.podcast_id !== id) return null;
  return record;
}

function nestedPodcast(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  return (body as { podcast?: unknown }).podcast ?? null;
}

function asPodcast(value: unknown): PodscanPodcast | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { podcast_id?: unknown; podcast_name?: unknown };
  if (typeof record.podcast_id !== "string" || typeof record.podcast_name !== "string") {
    return null;
  }
  return value as PodscanPodcast;
}

function podscanEndpointMissing(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return true;
  const status = Number((err as { status: unknown }).status);
  return status !== 404;
}

// Same bands as getDefaultPodcastRateCard in format-discovered-show.ts.
function defaultPodcastMidroll(audience: number): number {
  if (audience >= 200000) return 35;
  if (audience >= 50000) return 28;
  if (audience >= 10000) return 22;
  return 18;
}

function hasOnboardedRateCard(show: Show): boolean {
  return typeof show.min_buy === "number" && show.min_buy > 0;
}

function audienceFromPodscan(show: Show, onboarded: boolean): boolean {
  if (onboarded) return false;
  const sources = show.data_sources ?? [];
  if (
    sources.includes("direct_search") ||
    sources.includes("podscan") ||
    sources.includes("discovery")
  ) {
    return true;
  }
  return Boolean(show.podscan_id);
}

function baseCpm(show: Show, audience: number): number {
  const mid = show.rate_card?.midroll_cpm;
  if (typeof mid === "number" && Number.isFinite(mid) && mid > 0) return mid;
  const flat = show.rate_card?.flat_rate;
  if (
    show.price_type === "flat_rate" &&
    typeof flat === "number" &&
    Number.isFinite(flat) &&
    flat > 0 &&
    audience > 0
  ) {
    return flat / (audience / 1000);
  }
  return defaultPodcastMidroll(audience);
}

function asRecords(value: unknown): ScoredShowRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is ScoredShowRecord =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as ScoredShowRecord).podcastId === "string"
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.push(item);
  }
  return out;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
