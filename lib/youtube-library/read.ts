// Discovery reads the library before a live YouTube search.
// Eligible rows passed the market filter, have no brand flag, clear
// the same video-count and view floors discovery uses, and were
// refreshed within 30 days. Each confirmed ring keeps channels whose
// niche tag or source category sits in that ring's primary or adjacent
// categories. Rings are combined and deduped. Primary matches sort
// ahead of adjacent ones, then by views. The safety cap is 500.
// Fewer than 10 matches and the caller runs the live search for the rest.

import type { Show } from "@/lib/data/types";
import type { YouTubeChannelDetails, YouTubeRecentStats } from "@/lib/enrichment/youtube";
import { youtubeChannelToShow } from "@/lib/discovery/format-discovered-show";
import {
  channelLibraryCategories,
  mapRingToCategories,
  type LibraryCategory,
} from "./ring-categories";
import {
  draftToRecord,
  getYoutubeLibraryStore,
  isMissingLibraryTable,
  libraryConfigured,
  statsFreshCutoff,
  type ChannelDraft,
  type YoutubeChannelRecord,
  type YoutubeLibraryStore,
} from "./store";

/** Safety cap on combined library matches. Not a quality cutoff. */
export const YOUTUBE_LIBRARY_CAP = 500;
export const YOUTUBE_LIBRARY_LIVE_BELOW = 10;

/** Same floors as discover-shows.ts (D7). A test locks these numbers. */
export const LIBRARY_FLOOR = {
  videoCount: 10,
  recentViews: 10000,
  fallbackViews: 5000,
} as const;

const SCORE_STOP = new Set([
  "the", "and", "for", "with", "your", "you", "our", "from", "that", "this", "into", "about",
]);

export function channelPassesLibraryFloors(row: {
  video_count: number | null;
  total_view_count: number | null;
  avg_recent_views: number | null;
  avg_views_method: string | null;
}): boolean {
  const videos = row.video_count ?? 0;
  if (videos < LIBRARY_FLOOR.videoCount) return false;
  const recent = row.avg_views_method === "recent" && row.avg_recent_views != null;
  const avg = recent
    ? (row.avg_recent_views as number)
    : row.avg_recent_views ??
      Math.round((row.total_view_count ?? 0) / Math.max(videos, 1));
  const min = recent ? LIBRARY_FLOOR.recentViews : LIBRARY_FLOOR.fallbackViews;
  return avg >= min;
}

export function libraryMatchScore(
  row: Pick<YoutubeChannelRecord, "niche_tags" | "topic_categories" | "keywords">,
  brief: { ringTerms: string[]; interests: string[] }
): number {
  const tags = new Set(row.niche_tags.map((tag) => tag.toLowerCase()));
  const topicText = [...row.topic_categories, ...row.keywords, ...row.niche_tags].join(" ").toLowerCase();
  let score = 0;
  for (const interest of brief.interests) {
    const norm = interest.trim().toLowerCase();
    if (!norm) continue;
    if (tags.has(norm)) score += 5;
    else if (topicText.includes(norm)) score += 3;
  }
  for (const term of brief.ringTerms) {
    const norm = term.trim().toLowerCase();
    if (!norm) continue;
    if (topicText.includes(norm)) score += 4;
    const tokens = norm.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !SCORE_STOP.has(token));
    for (const token of tokens) {
      if (topicText.includes(token)) score += 1;
    }
  }
  return score;
}

function recordToDetails(row: YoutubeChannelRecord): YouTubeChannelDetails {
  return {
    channelId: row.channel_id,
    title: row.title ?? "",
    description: row.description ?? "",
    country: row.country ?? undefined,
    defaultLanguage: row.default_language ?? undefined,
    publishedAt: row.first_seen_at,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    subscriberCount: row.subscriber_count ?? 0,
    videoCount: row.video_count ?? 0,
    totalViewCount: row.total_view_count ?? 0,
    topicCategories: row.topic_categories,
    keywords: row.keywords,
    customUrl: row.custom_url ?? undefined,
  };
}

function recentStats(row: YoutubeChannelRecord): YouTubeRecentStats | undefined {
  if (row.avg_views_method !== "recent" || row.avg_recent_views == null) return undefined;
  return {
    videos: [],
    averageViews: row.avg_recent_views,
    averageLikes: 0,
    averageComments: 0,
    totalVideosAnalyzed: 0,
  };
}

export function libraryRowToShow(row: YoutubeChannelRecord): Show {
  return youtubeChannelToShow(recordToDetails(row), recentStats(row));
}

export interface LibraryRingInput {
  id: string;
  terms?: string[];
  interests?: string[];
  category?: string;
}

export interface LibraryRingHit {
  id: string;
  level: "primary" | "adjacent";
  terms: string[];
}

export interface RankedLibraryMatch {
  row: YoutubeChannelRecord;
  show: Show;
  matchLevel: "primary" | "adjacent";
  rings: LibraryRingHit[];
  categories: LibraryCategory[];
  /** Primary categories of the rings this channel matched. */
  primaryCategories: LibraryCategory[];
  views: number;
}

export interface LibraryBrief {
  ringTerms?: string[];
  interests?: string[];
  category?: string;
  rings?: LibraryRingInput[];
}

export function resolveLibraryRings(brief: LibraryBrief): LibraryRingInput[] {
  if (brief.rings && brief.rings.length > 0) return brief.rings;
  const terms = (brief.ringTerms ?? []).map((term) => term.trim()).filter(Boolean);
  const interests = brief.interests ?? [];
  const category = brief.category ?? "";
  if (terms.length === 0) {
    if (interests.length === 0 && !category.trim()) return [];
    return [{ id: category.trim() || interests[0] || "brief", terms: [], interests, category }];
  }
  return terms.map((term) => ({ id: term, terms: [term], interests, category }));
}

function libraryViews(row: YoutubeChannelRecord): number {
  const videos = row.video_count ?? 0;
  const recent = row.avg_views_method === "recent" && row.avg_recent_views != null;
  if (recent) return row.avg_recent_views as number;
  if (row.avg_recent_views != null) return row.avg_recent_views;
  return Math.round((row.total_view_count ?? 0) / Math.max(videos, 1));
}

export function rankLibraryMatches(
  rows: YoutubeChannelRecord[],
  brief: LibraryBrief,
  limit = YOUTUBE_LIBRARY_CAP
): RankedLibraryMatch[] {
  const rings = resolveLibraryRings(brief).map((ring) => {
    const mapped = mapRingToCategories(ring);
    return {
      ring,
      primary: new Set(mapped.primary),
      adjacent: new Set(mapped.adjacent),
      primaryList: mapped.primary,
    };
  });
  const byId = new Map<string, RankedLibraryMatch>();
  for (const row of rows) {
    if (!row.passed_market_filter || row.brand_flag) continue;
    if (!channelPassesLibraryFloors(row)) continue;
    const categories = channelLibraryCategories(row);
    if (categories.length === 0) continue;
    const hits: LibraryRingHit[] = [];
    const primaryCategories: LibraryCategory[] = [];
    const seenPrimary = new Set<string>();
    for (const mapped of rings) {
      const level = categories.some((cat) => mapped.primary.has(cat))
        ? "primary"
        : categories.some((cat) => mapped.adjacent.has(cat))
          ? "adjacent"
          : null;
      if (!level) continue;
      hits.push({
        id: mapped.ring.id,
        level,
        terms: (mapped.ring.terms ?? []).map((term) => term.trim()).filter(Boolean),
      });
      for (const cat of mapped.primaryList) {
        if (seenPrimary.has(cat)) continue;
        seenPrimary.add(cat);
        primaryCategories.push(cat);
      }
    }
    if (hits.length === 0) continue;
    const matchLevel = hits.some((hit) => hit.level === "primary") ? "primary" : "adjacent";
    const existing = byId.get(row.channel_id);
    if (existing) {
      for (const hit of hits) {
        if (!existing.rings.some((ring) => ring.id === hit.id)) existing.rings.push(hit);
      }
      for (const cat of categories) {
        if (!existing.categories.includes(cat)) existing.categories.push(cat);
      }
      for (const cat of primaryCategories) {
        if (!existing.primaryCategories.includes(cat)) existing.primaryCategories.push(cat);
      }
      existing.matchLevel = existing.rings.some((hit) => hit.level === "primary") ? "primary" : "adjacent";
      if (libraryViews(row) > existing.views) existing.views = libraryViews(row);
      continue;
    }
    byId.set(row.channel_id, {
      row,
      show: libraryRowToShow(row),
      matchLevel,
      rings: hits,
      categories,
      primaryCategories,
      views: libraryViews(row),
    });
  }
  const ranked = [...byId.values()];
  ranked.sort(
    (a, b) =>
      (a.matchLevel === "primary" ? 0 : 1) - (b.matchLevel === "primary" ? 0 : 1) ||
      b.views - a.views ||
      (b.row.subscriber_count ?? 0) - (a.row.subscriber_count ?? 0) ||
      a.row.channel_id.localeCompare(b.row.channel_id)
  );
  return ranked.slice(0, limit);
}

export function mergeLibraryFirst(library: Show[], live: Show[]): Show[] {
  if (library.length === 0) return live;
  const seen = new Set(library.map((show) => show.youtube_channel_id).filter((id): id is string => !!id));
  const out = library.slice();
  for (const show of live) {
    const id = show.youtube_channel_id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(show);
  }
  return out;
}

async function resolveStore(store?: YoutubeLibraryStore): Promise<YoutubeLibraryStore | null> {
  if (store) return store;
  if (!libraryConfigured()) return null;
  return getYoutubeLibraryStore();
}

export async function readYoutubeLibraryMatches(input: LibraryBrief & {
  store?: YoutubeLibraryStore;
  now?: Date;
}): Promise<RankedLibraryMatch[]> {
  const store = await resolveStore(input.store);
  if (!store) return [];
  try {
    const cutoff = statsFreshCutoff(input.now ?? new Date());
    const rows = await store.listEligible(cutoff);
    return rankLibraryMatches(rows, input);
  } catch (err) {
    if (!isMissingLibraryTable(err)) {
      console.warn("[youtube-library] read failed");
    }
    return [];
  }
}

export async function readYoutubeLibraryForDiscovery(input: LibraryBrief & {
  store?: YoutubeLibraryStore;
  now?: Date;
}): Promise<Show[]> {
  const matches = await readYoutubeLibraryMatches(input);
  return matches.map((match) => match.show);
}

/** Store live top-up channels. Missing table and other errors stay quiet. */
export async function absorbDiscoveredChannels(
  drafts: ChannelDraft[],
  store?: YoutubeLibraryStore
): Promise<void> {
  if (drafts.length === 0) return;
  const resolved = await resolveStore(store);
  if (!resolved) return;
  try {
    for (const draft of drafts) {
      let showId: string | null = null;
      try {
        showId = await resolved.uniqueShowId(draft.details.channelId, draft.details.customUrl);
      } catch (err) {
        if (isMissingLibraryTable(err)) return;
      }
      const existing = await resolved.getChannel(draft.details.channelId);
      const record = draftToRecord(existing, draft, showId);
      if (!existing) record.source = "discovery";
      await resolved.saveChannel(record);
    }
  } catch (err) {
    if (!isMissingLibraryTable(err)) console.warn("[youtube-library] absorb failed");
  }
}

/**
 * Library matches first. The live search runs only when the combined
 * library total is under 10.
 */
export async function takeLibraryThenLive(input: LibraryBrief & {
  store?: YoutubeLibraryStore;
  now?: Date;
  mapShow?: (match: RankedLibraryMatch) => Show;
  live: () => Promise<Show[]>;
}): Promise<Show[]> {
  const matches = await readYoutubeLibraryMatches(input);
  const library = matches.map((match) => (input.mapShow ? input.mapShow(match) : match.show));
  if (library.length >= YOUTUBE_LIBRARY_LIVE_BELOW) {
    console.log(`[discovery] YouTube library matches: ${library.length}`);
    return library;
  }
  const live = await input.live();
  return mergeLibraryFirst(library, live);
}
