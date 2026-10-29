// ============================================================
// SHOW DISCOVERY ORCHESTRATOR
// Searches Podscan + YouTube APIs in parallel to discover shows
// matching a campaign brief. Returns Show[] formatted identically
// to database shows for seamless merging.
//
// STRATEGY:
// 1. Search Podscan via /episodes/search with 5-6 diverse text queries,
//    each filtered by category IDs. Extract unique podcasts from results.
// 2. Search YouTube videos once per planned query (capped at 4), topping up
//    with the interest query and shorter ring tails when the ring list is short.
// 3. Deduplicate across all queries by podcast_id
// 4. Claude scores the final fit using brand context + keywords
// ============================================================

import type { Show, ShowSurface } from "@/lib/data/types";
import { getPodscanClientSafe, type PodscanPodcast } from "@/lib/enrichment/podscan";
import {
  getYouTubeClientSafe,
  UPLOADS_STATS_UNITS,
  type YouTubeChannelDetails,
  type YouTubeUploadsStats,
} from "@/lib/enrichment/youtube";
import {
  buildYouTubeQueries,
  buildYouTubeQuery,
  buildDiscoveryQueries,
  MAX_YOUTUBE_SEARCHES,
} from "./category-mapping";
import { podscanPodcastToShow, youtubeChannelToShow } from "./format-discovered-show";
import {
  absorbDiscoveredChannels,
  takeLibraryThenLive,
  type LibraryRingInput,
  type RankedLibraryMatch,
} from "@/lib/youtube-library/read";
import { redactSecretParams } from "./redact-secrets";
import {
  mediumPriorsForShow,
  podcastSurfaceFromShow,
  youtubeSurfaceFromShow,
} from "./show-surfaces";

export interface DiscoveryBrief {
  target_interests: string[];
  keywords: string[];
  target_age_range?: string;
  target_gender?: string;
  campaign_goals?: string;
  platforms: string[];
  /**
   * Confirmed ring labels in slot order. YouTube searches each label
   * (normalized), capped at MAX_YOUTUBE_SEARCHES. Fewer than 4 ring queries
   * are topped up with the interest/keyword query and shorter tails. Briefs
   * with no labels get one interest/keyword search.
   */
  ring_terms?: string[];
}

export interface DiscoveryResult {
  discovered: Show[];
  sources: { podscan: number; youtube: number };
  errors: string[];
}

/** Minimum audience size for discovered shows */
const MIN_PODCAST_AUDIENCE = 5000;
/** Floor when average views come from a recent-video stats fetch. */
export const MIN_YOUTUBE_AVG_VIEWS = 10000;
/** Floor when average views fall back to total views / video count. */
export const MIN_YOUTUBE_AVG_VIEWS_FALLBACK = 5000;
export const MIN_YOUTUBE_VIDEO_COUNT = 10;

/** search.list maxResults per video search. YouTube allows up to 50. */
const YOUTUBE_SEARCH_MAX_RESULTS = 50;
/** channels.list accepts at most 50 ids per call. */
const YOUTUBE_CHANNEL_ID_BATCH = 50;
/** Worst case unique channels from the capped video searches. */
const YOUTUBE_DISCOVERY_CHANNEL_CAP = MAX_YOUTUBE_SEARCHES * YOUTUBE_SEARCH_MAX_RESULTS;

/**
 * YouTube Data API units for one discovery run.
 * Video search: MAX_YOUTUBE_SEARCHES x 100 = 400. search.list costs 100
 * with type=video, the same as type=channel.
 * Channel details: 1 unit per batch of 50 ids. Worst case is 4 x 50 = 200
 * unique channels, which is 4 calls. Together that is 404.
 * Recent views come from the uploads playlist for every channel that passes
 * the market filter. playlistItems.list plus videos.list is 2 units.
 * 200 x 2 = 400. Worst case: 400 + 404 = 804.
 */
export const YOUTUBE_DISCOVERY_QUOTA = {
  videoSearch: MAX_YOUTUBE_SEARCHES * 100,
  channelDetailsWorstCase: Math.ceil(YOUTUBE_DISCOVERY_CHANNEL_CAP / YOUTUBE_CHANNEL_ID_BATCH),
  recentVideoStats: YOUTUBE_DISCOVERY_CHANNEL_CAP * UPLOADS_STATS_UNITS,
  worstCase:
    MAX_YOUTUBE_SEARCHES * 100 +
    Math.ceil(YOUTUBE_DISCOVERY_CHANNEL_CAP / YOUTUBE_CHANNEL_ID_BATCH) +
    YOUTUBE_DISCOVERY_CHANNEL_CAP * UPLOADS_STATS_UNITS,
} as const;

/**
 * Strong commercial phrases. Matched on word boundaries in the description.
 * A hit is a brand channel only when the description has no creator signal.
 * Bare "shop" and "store" are not in this list (creators write "shop my
 * favorites" and "merch store"). "shop" and "store" still count when the
 * title ends with them.
 */
const BRAND_COMMERCIAL_PHRASES = [
  "official website",
  "our products",
  "buy now",
  "free shipping",
  "use code",
  "customer service",
  "order now",
] as const;

const BRAND_COMMERCIAL_PHRASE_RES = BRAND_COMMERCIAL_PHRASES.map((phrase) => ({
  phrase,
  re: new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
}));

/** Title suffixes that mark a company channel. Compared at a word boundary. */
const BRAND_TITLE_MARKER_LABELS: Record<string, string> = {
  inc: "Inc",
  llc: "LLC",
  official: "Official",
  store: "Store",
  shop: "Shop",
  co: "Co",
};

/**
 * First person or host language in the description. A commercial phrase
 * does not mark a brand when one of these is present. Title markers still do.
 */
const CREATOR_SIGNAL =
  /\b(?:i am|i'm|i’m|i|my|me|host|creator|podcast|youtuber|vlogs?|vlogger|merch|favorites?)\b/i;

/**
 * Discover shows from Podscan and YouTube APIs based on a campaign brief.
 *
 * Podscan: 5-6 diverse queries via /episodes/search, extracting unique podcasts.
 * YouTube: up to 4 text queries. Ring labels first, then the interest query
 * and shorter tails when the ring list is short.
 *
 * API budget per call:
 * - Podscan: 5-6 requests (well within 10/min limit with staggering)
 * - YouTube quota units (Data API v3: search.list = 100, channels.list = 1,
 *   videos.list = 1). See YOUTUBE_DISCOVERY_QUOTA.
 */
export async function discoverShows(brief: DiscoveryBrief): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const discovered: Show[] = [];

  const wantsPodcast = brief.platforms.includes("podcast");
  const wantsYoutube = brief.platforms.includes("youtube");

  // Ring queries, topped up to MAX_YOUTUBE_SEARCHES. searchVideos keeps
  // regionCode=US and relevanceLanguage=en. The interest string is also
  // passed through so an all-empty run can retry it once inside the cap.
  const youtubeQueries = buildYouTubeQueries(brief);
  const youtubeInterestFallback = buildYouTubeQuery(brief);

  // Run Podscan + YouTube discovery in parallel
  const [podcastShows, youtubeShows] = await Promise.all([
    wantsPodcast ? discoverFromPodscan(brief, errors) : Promise.resolve([]),
    wantsYoutube
      ? discoverFromYoutube(
          youtubeQueries,
          errors,
          youtubeInterestFallback,
          brief.target_interests,
          {
            rings: (brief.ring_terms ?? [])
              .map((term) => term.trim())
              .filter(Boolean)
              .map((term) => ({ id: term, terms: [term] })),
            category: brief.keywords.filter((keyword) => keyword.trim()).join(" "),
          }
        )
      : Promise.resolve([]),
  ]);

  discovered.push(...podcastShows, ...youtubeShows);

  return {
    discovered,
    sources: { podscan: podcastShows.length, youtube: youtubeShows.length },
    errors,
  };
}

/**
 * Search Podscan for podcasts using /episodes/search with diverse queries.
 *
 * Why /episodes/search instead of /podcasts/search:
 * - /podcasts/search is not available on all Podscan plans
 * - /episodes/search with show_full_podcast=true returns full podcast data
 * - Text queries find shows whose episodes discuss relevant topics
 * - Category IDs filter to the right audience segments
 *
 * Runs 5-6 queries in parallel, deduplicates by podcast_id.
 */
async function discoverFromPodscan(
  brief: DiscoveryBrief,
  errors: string[]
): Promise<Show[]> {
  const client = getPodscanClientSafe();
  if (!client) return [];

  const podcastMap = new Map<string, PodscanPodcast>();

  try {
    const queries = buildDiscoveryQueries(brief);

    if (queries.length === 0) {
      errors.push("No discovery queries generated — check interests and keywords");
      return [];
    }

    console.log(`[discovery] Running ${queries.length} Podscan queries...`);

    // Run all queries in parallel
    const searchPromises = queries.map((q, idx) =>
      client
        .searchEpisodes({
          query: q.query,
          categoryIds: q.categoryIds || undefined,
          minAudienceSize: MIN_PODCAST_AUDIENCE,
          hasSponsors: q.hasSponsors,
          perPage: q.perPage,
          orderBy: "best_match",
        })
        .then((result) => {
          let added = 0;
          for (const episode of result.data) {
            // Extract podcast from episode — searchEpisodes with show_full_podcast=true
            // nests the podcast object inside the episode
            const podcast = episode.podcast;
            const podcastId = podcast?.podcast_id ?? episode.podcast_id;

            if (!podcastId || podcastMap.has(podcastId)) continue;

            if (podcast) {
              podcastMap.set(podcastId, podcast);
              added++;
            } else if (episode.podcast_name) {
              // Fallback: build a minimal podcast record from episode fields
              podcastMap.set(podcastId, {
                podcast_id: podcastId,
                podcast_name: episode.podcast_name,
                podcast_url: episode.podcast_url,
                podcast_description: episode.episode_description,
                podcast_image_url: episode.episode_image_url,
              });
              added++;
            }
          }
          console.log(`[discovery] Query ${idx + 1} "${q.query.slice(0, 40)}..." → ${result.data.length} episodes, ${added} new podcasts`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.warn(`[discovery] Query ${idx + 1} failed: ${msg}`);
          errors.push(`Podscan query "${q.query.slice(0, 30)}": ${msg}`);
        })
    );

    await Promise.all(searchPromises);
  } catch (err) {
    errors.push(
      `Podscan discovery failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  console.log(`[discovery] Total unique podcasts found: ${podcastMap.size}`);

  // Filter: ensure minimum audience size
  const filtered = Array.from(podcastMap.values()).filter((p) => {
    const audienceSize = p.reach?.audience_size ?? 0;
    // For shows without audience data, still include them — Claude will filter by fit
    // Only exclude shows we KNOW are too small
    return audienceSize >= MIN_PODCAST_AUDIENCE || audienceSize === 0;
  });

  console.log(`[discovery] After audience filter (>=${MIN_PODCAST_AUDIENCE}): ${filtered.length} podcasts`);

  return filtered.map((p) => podscanPodcastToShow(p));
}

export interface YoutubeLibraryRing {
  id: string;
  terms: string[];
}

export interface DiscoverYoutubeOptions {
  store?: Parameters<typeof takeLibraryThenLive>[0]["store"];
  now?: Date;
  /** Raw confirmed ring labels. Live search still uses `queries`. */
  rings?: YoutubeLibraryRing[];
  /** Brief product category, used when a ring matches no library category. */
  category?: string;
}

/**
 * Topical labels for a library channel that matched a ring at primary or
 * adjacent level. Both levels receive the same list: the matched ring
 * terms, or the ring's primary categories when the ring has no terms.
 * Scoring weights, bands, and the topical formula are unchanged. This is
 * only the input those formulas already read.
 */
export function youtubeLibraryTopicalInput(input: {
  matchLevel: "primary" | "adjacent";
  ringTerms: string[];
  primaryCategories: readonly string[];
}): string[] {
  if (input.matchLevel !== "primary" && input.matchLevel !== "adjacent") return [];
  const terms = dedupeLabels(input.ringTerms);
  if (terms.length > 0) return terms;
  return dedupeLabels(input.primaryCategories);
}

function dedupeLabels(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
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

/** Add the shared primary-match topical labels. Categories stay as stored. */
export function applyYoutubeLibraryTopicalInput(
  show: Show,
  input: {
    matchLevel: "primary" | "adjacent";
    ringTerms: string[];
    primaryCategories: readonly string[];
  }
): Show {
  const labels = youtubeLibraryTopicalInput(input);
  if (labels.length === 0) return show;
  return {
    ...show,
    audience_interests: dedupeLabels([...(show.audience_interests ?? []), ...labels]),
  };
}

function stampLibraryTopical(match: RankedLibraryMatch): Show {
  return applyYoutubeLibraryTopicalInput(match.show, {
    matchLevel: match.matchLevel,
    ringTerms: match.rings.flatMap((ring) => ring.terms),
    primaryCategories: match.primaryCategories,
  });
}

/**
 * Search YouTube videos for the planned queries (capped at 4). The live
 * top-up calls searchVideos with order relevance, over the last 12 months,
 * with regionCode=US and relevanceLanguage=en. Channel ids come from
 * snippet.channelId, first occurrence wins, in that rank order. Channel
 * search is not also run.
 * The market filter below is the hard keep/drop, using the channel-details
 * response. Recent views then come from the uploads playlist for every
 * channel that survives it.
 *
 * Library rows are read first, one combined list across confirmed rings.
 * A channel that matched at primary or adjacent level gets the same
 * topical input. If every search returns 0 channels, run the interest
 * fallback once when it was not already searched and the 4-search cap
 * still has room.
 */
async function loadRecentUploads(
  client: {
    recentUploadsStats?: (
      channelId: string,
      options?: { fallbackAverage?: number | null }
    ) => Promise<YouTubeUploadsStats>;
  },
  channel: YouTubeChannelDetails
): Promise<YouTubeUploadsStats | null> {
  if (typeof client.recentUploadsStats !== "function") return null;
  const fallbackAverage = channel.videoCount > 0 ? channel.totalViewCount / channel.videoCount : null;
  try {
    const stats = await client.recentUploadsStats(channel.channelId, { fallbackAverage });
    if (!stats || stats.method !== "uploads") return null;
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[discovery] recent uploads stats failed: ${redactSecretParams(message)}`);
    return null;
  }
}

export async function discoverFromYoutube(
  queries: string[],
  errors: string[],
  interestFallback = "",
  interests: string[] = [],
  options?: DiscoverYoutubeOptions
): Promise<Show[]> {
  const rings: LibraryRingInput[] = libraryRingsForDiscovery(queries, interests, options);
  return takeLibraryThenLive({
    rings,
    interests,
    category: options?.category ?? "",
    store: options?.store,
    now: options?.now,
    mapShow: stampLibraryTopical,
    live: () => discoverFromYoutubeLive(queries, errors, interestFallback),
  });
}

function libraryRingsForDiscovery(
  queries: string[],
  interests: string[],
  options?: DiscoverYoutubeOptions
): LibraryRingInput[] {
  const category = options?.category ?? "";
  const provided = (options?.rings ?? []).filter((ring) => ring.id.trim() || ring.terms.some((term) => term.trim()));
  if (provided.length > 0) {
    return provided.map((ring) => ({
      id: ring.id.trim() || ring.terms.find((term) => term.trim()) || "ring",
      terms: ring.terms.map((term) => term.trim()).filter(Boolean),
      interests,
      category,
    }));
  }
  return queries
    .map((query) => query.trim())
    .filter(Boolean)
    .map((query) => ({ id: query, terms: [query], interests, category }));
}

async function discoverFromYoutubeLive(
  queries: string[],
  errors: string[],
  interestFallback = ""
): Promise<Show[]> {
  const client = getYouTubeClientSafe();
  if (!client) return [];

  const capped = queries
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, MAX_YOUTUBE_SEARCHES);
  if (capped.length === 0) return [];

  try {
    console.log(`[discovery] Running ${capped.length} YouTube queries...`);

    const runQuery = async (query: string, idx: number) => {
      try {
        const hits = await client.searchVideos(query, YOUTUBE_SEARCH_MAX_RESULTS, "relevance");
        const found = uniqueChannelIds(hits);
        console.log(
          `[discovery] YouTube query ${idx + 1} "${query.slice(0, 40)}" → ${found.length} channels`
        );
        return hits;
      } catch (err) {
        const msg = redactSecretParams(err instanceof Error ? err.message : "unknown error");
        console.warn(`[discovery] YouTube query ${idx + 1} failed: ${msg}`);
        errors.push(`YouTube query "${query.slice(0, 40)}": ${msg}`);
        return [];
      }
    };

    const batches = await Promise.all(capped.map((query, idx) => runQuery(query, idx)));

    const retry = youtubeInterestRetry(
      capped,
      batches.map((hits) => uniqueChannelIds(hits).length),
      interestFallback
    );
    if (retry) {
      batches.push(await runQuery(retry, capped.length));
    }

    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const hits of batches) {
      for (const channelId of uniqueChannelIds(hits)) {
        if (seen.has(channelId)) continue;
        seen.add(channelId);
        orderedIds.push(channelId);
      }
    }
    console.log(`[discovery] YouTube unique channels: ${orderedIds.length}`);
    if (orderedIds.length === 0) return [];

    const channelDetails: YouTubeChannelDetails[] = [];
    for (let i = 0; i < orderedIds.length; i += YOUTUBE_CHANNEL_ID_BATCH) {
      const slice = orderedIds.slice(i, i + YOUTUBE_CHANNEL_ID_BATCH);
      const details = await client.getMultipleChannelDetails(slice);
      channelDetails.push(...details);
    }
    if (channelDetails.length === 0) return [];

    const byId = new Map(channelDetails.map((ch) => [ch.channelId, ch]));
    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((ch): ch is NonNullable<typeof ch> => !!ch);

    // Hard market filter before the view/video filters and before scoring.
    const inMarket = ordered.filter((ch) => passesYouTubeMarketFilter(ch));
    console.log(
      `[discovery] YouTube after market filter: ${inMarket.length} of ${ordered.length}`
    );
    if (inMarket.length === 0) return [];

    const ranked = [...inMarket].sort((a, b) => b.subscriberCount - a.subscriberCount);

    const statsResults = await Promise.all(
      ranked.map(async (ch) => {
        const stats = await loadRecentUploads(client, ch);
        return { channelId: ch.channelId, stats };
      })
    );

    const statsMap = new Map<string, YouTubeUploadsStats>();
    for (const row of statsResults) {
      if (row.stats) statsMap.set(row.channelId, row.stats);
    }

    // Same three checks, same order, as the previous single filter.
    // Counts are exclusive: a channel dropped for video count is not
    // counted again as a brand channel or as low views.
    const kept: YouTubeChannelDetails[] = [];
    let droppedVideoCount = 0;
    let droppedBrandKeyword = 0;
    const brandKeywordMatches: string[] = [];
    let droppedAvgViews = 0;
    let droppedRecentViews = 0;
    let droppedFallbackViews = 0;
    let recentMethod = 0;
    let fallbackMethod = 0;
    const survivorAvgViews: number[] = [];

    for (const ch of ranked) {
      if (ch.videoCount < MIN_YOUTUBE_VIDEO_COUNT) {
        droppedVideoCount++;
        continue;
      }

      const matchedKeyword = youtubeBrandMatch(ch);
      if (matchedKeyword) {
        droppedBrandKeyword++;
        if (brandKeywordMatches.length < 5) {
          brandKeywordMatches.push(`"${ch.title}" matched "${matchedKeyword}"`);
        }
        continue;
      }

      const stats = statsMap.get(ch.channelId);
      const avgViews = stats
        ? stats.averageViews
        : Math.round(ch.totalViewCount / Math.max(ch.videoCount, 1));
      const minViews = stats ? MIN_YOUTUBE_AVG_VIEWS : MIN_YOUTUBE_AVG_VIEWS_FALLBACK;
      if (stats) recentMethod++;
      else fallbackMethod++;
      if (avgViews < minViews) {
        droppedAvgViews++;
        if (stats) droppedRecentViews++;
        else droppedFallbackViews++;
        continue;
      }

      kept.push(ch);
      survivorAvgViews.push(avgViews);
    }

    const medianAvgViews = medianNumber(survivorAvgViews);
    console.log(
      `[discovery] YouTube dropped videoCount < ${MIN_YOUTUBE_VIDEO_COUNT}: ${droppedVideoCount}`
    );
    console.log(
      `[discovery] YouTube dropped brand keyword: ${droppedBrandKeyword}` +
        (brandKeywordMatches.length > 0
          ? `; first ${brandKeywordMatches.length}: ${brandKeywordMatches.join("; ")}`
          : "")
    );
    console.log(
      `[discovery] YouTube dropped avgViews: ${droppedAvgViews} (recent < ${MIN_YOUTUBE_AVG_VIEWS}: ${droppedRecentViews}, fallback < ${MIN_YOUTUBE_AVG_VIEWS_FALLBACK}: ${droppedFallbackViews})`
    );
    console.log(
      `[discovery] YouTube avgViews method: recent=${recentMethod} fallback=${fallbackMethod}`
    );
    console.log(
      `[discovery] YouTube survivor median avgViews: ${medianAvgViews === null ? "n/a" : medianAvgViews}`
    );
    console.log(`[discovery] YouTube returned: ${kept.length}`);

    const shows = kept.map((ch) => youtubeChannelToShow(ch, statsMap.get(ch.channelId) ?? undefined));
    const sourceQuery = queries.join(" | ").slice(0, 500);
    const seenAt = new Date().toISOString();
    try {
      await absorbDiscoveredChannels(
        kept.map((ch) => ({
          details: ch,
          passedMarketFilter: true,
          brandFlag: null,
          source: "discovery" as const,
          sourceQuery,
          averageViews: statsMap.get(ch.channelId)?.averageViews,
          viewsMethod: statsMap.has(ch.channelId) ? "recent" : "estimated",
          now: seenAt,
        }))
      );
    } catch {
      // The library write is fail-soft. Live shows still return.
    }
    return shows;
  } catch (err) {
    const message = redactSecretParams(err instanceof Error ? err.message : "unknown error");
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      "[discovery] YouTube discovery failed:",
      message,
      stack ? redactSecretParams(stack) : stack
    );
    errors.push(`YouTube discovery failed: ${message}`);
    return [];
  }
}

/**
 * Brand-channel label for the D6 match log, or null when the channel is a
 * creator. Description phrases match on word boundaries and only count when
 * the description has no creator signal. A title that ends with Inc, LLC,
 * Official, Store, Shop, or Co is a brand either way.
 */
export function youtubeBrandMatch(channel: {
  title?: string | null;
  description?: string | null;
}): string | null {
  const description = channel.description ?? "";
  if (!CREATOR_SIGNAL.test(description)) {
    for (const { phrase, re } of BRAND_COMMERCIAL_PHRASE_RES) {
      if (re.test(description)) return phrase;
    }
  }
  return titleCompanyMarker(channel.title ?? "");
}

function titleCompanyMarker(title: string): string | null {
  const trimmed = title.trim().replace(/[\s.]+$/g, "");
  const match = trimmed.match(/\b(inc|llc|official|store|shop|co)$/i);
  if (!match) return null;
  return BRAND_TITLE_MARKER_LABELS[match[1].toLowerCase()] ?? match[1];
}

/** snippet.channelId values from one video-search page, first occurrence kept. */
function uniqueChannelIds(hits: { channelId?: string | null }[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const channelId = hit.channelId?.trim() ?? "";
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);
    ids.push(channelId);
  }
  return ids;
}

/** Median of a numeric list. Even counts average the two middle values. */
function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Interest query to run after a batch where every search returned 0 channels.
 * Null when any search hit, the fallback already ran, the fallback is blank,
 * or the 4-search cap is full.
 */
export function youtubeInterestRetry(
  searched: string[],
  hitCounts: number[],
  interestFallback: string
): string | null {
  if (searched.length === 0 || searched.length >= MAX_YOUTUBE_SEARCHES) return null;
  if (hitCounts.length !== searched.length) return null;
  if (hitCounts.some((count) => count > 0)) return null;
  const fallback = interestFallback.trim();
  if (!fallback) return null;
  const seen = new Set(searched.map((query) => query.toLowerCase()));
  if (seen.has(fallback.toLowerCase())) return null;
  return fallback;
}

const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "of", "to", "a", "in", "for", "with", "on", "your", "you",
  "our", "this", "that", "is", "are", "from", "how", "what", "why", "about",
  "my", "we", "it", "be", "or", "at", "by", "as", "an", "not", "have", "has",
  "was", "were", "but", "can", "will", "just", "more", "all", "into", "than",
  "then", "them", "their", "his", "her", "its", "if", "so", "do", "does",
  "did", "been", "being", "these", "those", "there", "here", "when", "where",
  "who", "which", "also", "because", "while", "after", "before", "over",
  "under", "between", "through", "each", "other", "some", "any", "every",
]);

// Function words that mark Latin-script text as not English. Used only when
// the channel has no country and no English language tag.
const NON_ENGLISH_LATIN =
  /\b(que|los|las|una|unos|para|con|por|del|les|des|une|dans|und|der|die|das|nicht|ein|eine|nao|como|mais|esta|este|hola|bonjour|gracias|muito|voce|juga|yang|dengan|untuk|dari)\b/i;

function languageTagIsEnglish(tag: string | null | undefined): boolean {
  if (!tag) return false;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return primary === "en";
}

function textReadsAsEnglish(title: string, description: string): boolean {
  const text = `${title} ${description}`.trim();
  if (!text) return false;

  let latin = 0;
  let nonLatin = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    if (/\p{Script=Latin}/u.test(ch)) latin++;
    else nonLatin++;
  }
  const letters = latin + nonLatin;
  if (letters === 0) return false;
  if (nonLatin / letters >= 0.2) return false;

  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let englishHits = 0;
  for (const token of tokens) {
    if (ENGLISH_FUNCTION_WORDS.has(token)) englishHits++;
  }
  if (englishHits >= 2) return true;
  if (NON_ENGLISH_LATIN.test(text) && englishHits === 0) return false;

  const accented = text.match(/[àáâãäåæçèéêëìíîïñòóôõöùúûüýÿœ]/gi)?.length ?? 0;
  if (accented >= 2 && englishHits === 0) return false;
  if (englishHits >= 1) return true;
  return nonLatin === 0 && latin > 0;
}

/**
 * Keep a channel when snippet.country is US, or when country is missing and
 * either defaultLanguage or the title/description reads as English.
 * A set country other than US (IN, GB, ...) is dropped even if the copy is
 * English. Runs on channel details, before scoring.
 */
export function passesYouTubeMarketFilter(channel: {
  country?: string | null;
  defaultLanguage?: string | null;
  title?: string | null;
  description?: string | null;
}): boolean {
  const country = (channel.country ?? "").trim().toUpperCase();
  if (country === "US") return true;
  if (country) return false;
  if (languageTagIsEnglish(channel.defaultLanguage)) return true;
  return textReadsAsEnglish(channel.title ?? "", channel.description ?? "");
}

// ============================================================
// SHOW-TYPE GENRE EXCLUSION (Wave 14 Phase 2B Layer 3, spec §11)
//
// Sleep / Meditation / ASMR shows are excluded from results ENTIRELY — a hard
// genre filter applied BEFORE scoring, regardless of audience overlap. These
// don't fit the host-read DTC model (DAI-sold, listeners tuning out to fall
// asleep, no conversion playbook). The brand never sees them to override:
// that's intended — a platform fit call, not a brand call. Empty-calorie
// results (e.g. "Get Sleepy" ranking high) are a launch credibility hit.
//
// Tolerant of taxonomy variants: matches the genre word at a word boundary
// across a show's categories, audience_interests, AND name (so a sleep cast
// whose Podscan category is generic but whose identity is unmistakable —
// "Get Sleepy" — is still caught). Conservative families only: sleep,
// meditation, asmr. The tradeoff — a metaphorical title ("Sleepless CEO")
// could be over-excluded — is deliberately accepted: this is a hard platform
// fit filter, and missing one borderline business show beats surfacing sleep
// inventory at launch.
// ============================================================

export const EXCLUDED_GENRE_PATTERNS: RegExp[] = [
  /\bsleep/i, // sleep, sleepy, sleepcast, sleep sounds, sleep stories
  /\bmeditat/i, // meditation, meditations, guided meditation, meditative
  /\basmr\b/i, // asmr
];

// Clinical / scientific framing means the show is ABOUT sleep (or the mind) as
// a health topic — sleep medicine, apnea, insomnia research, neuroscience —
// not a sleep-AID genre show (sleepcasts, sleep sounds). Those are legitimate
// host-read health shows a recovery/wellness brand may want, so they are NOT
// hard-excluded. Deliberately narrow: only unambiguous clinical terms a
// sleep-aid show would essentially never use, to avoid re-opening the
// false-negative door (a sleepcast that merely markets itself as "science").
// Best-effort and calibratable — log misses to SCORING_CALIBRATION.md.
const GENRE_CLINICAL_EXEMPTION =
  /\b(apnea|insomnia|medicine|medical|clinic|clinical|neuroscience|disorder|diagnosis|physician)\b/i;

function genreHaystack(show: Show): string {
  return [
    show.name,
    ...(show.categories ?? []),
    ...(show.audience_interests ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[_\-]+/g, " ");
}

/** True if a show is a Sleep / Meditation / ASMR genre show (hard-excluded). */
export function isExcludedGenre(show: Show): boolean {
  const hay = genreHaystack(show);
  if (!EXCLUDED_GENRE_PATTERNS.some((re) => re.test(hay))) return false;
  // Matched a genre word, but exempt clinical/scientific health shows.
  if (GENRE_CLINICAL_EXEMPTION.test(hay)) return false;
  return true;
}

/** Drop Sleep / Meditation / ASMR shows before scoring (§11 hard filter). */
export function excludeExcludedGenres(shows: Show[]): Show[] {
  return shows.filter((s) => !isExcludedGenre(s));
}

// ============================================================
// ZERO-VIEW YOUTUBE HARD FILTER (Wave 14 Phase 2C Layer 1b)
//
// A discovery-quality filter in the same family as the Sleep/ASMR genre
// exclusion above — applied BEFORE scoring, not a scoring change. YouTube
// view counts are public and reliable, so a 0-view channel is dead
// inventory. Because YouTube is flat-fee priced, leaving it in would stamp
// a real-looking $2K price on a channel nobody watches — the
// priced-empty-calorie credibility hit. Excluded here so these are never
// conviction-scored or surfaced.
//
// Asymmetry with podcasts is intentional: a podcast with 0 downloads is
// kept (Podscan often lacks reach data for a live show; it flows to
// needs_quote in Layer 1), but a public YouTube view count of 0 is
// trustworthy enough to drop the channel outright.
// ============================================================

/** True if a show is a zero-view YouTube channel (dead inventory). */
export function isDeadYouTube(show: Show): boolean {
  return show.platform === "youtube" && (show.audience_size ?? 0) <= 0;
}

/** Drop zero-view YouTube channels before scoring (Phase 2C Layer 1b). */
export function excludeDeadYouTube(shows: Show[]): Show[] {
  return shows.filter((s) => !isDeadYouTube(s));
}

// ============================================================
// SIMULCAST MERGE
//
// A simulcast is one show published on both podcast and long-form YouTube.
// Discovery may return both as separate Show records; this folds them into
// ONE record so the universe doesn't double-list or double-count reach.
//
// Identity is the normalized name (a trailing "podcast" / "youtube" /
// "channel" is ignored). The podcast record stays primary — it carries the
// CPM rate card scoring already uses. The YouTube record is dropped as its
// own row and attached under surfaces.youtube. show.audience_size stays the
// podcast audience. The YouTube audience lives on the surface and is not
// added in.
//
// Single-medium shows do not get a surfaces object. Every emitted show gets
// medium_priors for the mediums it occupies. The prior's engagement weight
// is 1 and is not a score.
// ============================================================

/** Match key for simulcast identity. Exported for tests. */
export function normalizeShowName(name: string): string {
  let spaced = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let prev = "";
  while (spaced !== prev) {
    prev = spaced;
    spaced = spaced.replace(/ (podcast|youtube|yt|channel)$/, "").trim();
  }
  return spaced;
}

function withPriors(show: Show): Show {
  return { ...show, medium_priors: mediumPriorsForShow(show, show.surfaces) };
}

export function mergeSimulcasts(shows: Show[]): Show[] {
  // Index podcast records by normalized name; first occurrence is the primary.
  const podcastByName = new Map<string, Show>();
  for (const s of shows) {
    if (s.platform !== "podcast") continue;
    const key = normalizeShowName(s.name);
    if (key && !podcastByName.has(key)) podcastByName.set(key, s);
  }

  // First matching YouTube record wins. Later duplicates are folded away so
  // they are not emitted as a second show, and they do not replace the
  // surface already attached.
  const youtubeSurfaceFor = new Map<string, ShowSurface>();
  const youtubeChannelFor = new Map<string, string | undefined>();
  const foldedYoutubeIds = new Set<string>();
  for (const s of shows) {
    if (s.platform !== "youtube") continue;
    const key = normalizeShowName(s.name);
    const primary = key ? podcastByName.get(key) : undefined;
    if (!primary) continue;
    foldedYoutubeIds.add(s.id);
    if (youtubeSurfaceFor.has(primary.id)) continue;
    youtubeSurfaceFor.set(primary.id, youtubeSurfaceFromShow(s));
    youtubeChannelFor.set(primary.id, s.youtube_channel_id);
  }

  const out: Show[] = [];
  for (const s of shows) {
    if (s.platform === "youtube") {
      if (foldedYoutubeIds.has(s.id)) continue;
      out.push(withPriors(s));
      continue;
    }
    const yt = youtubeSurfaceFor.get(s.id);
    if (!yt) {
      out.push(withPriors(s));
      continue;
    }
    // Shallow-clone the primary so we never mutate the caller's array.
    // Podcast audience stays on the row. YouTube audience stays on the surface.
    const surfaces = {
      ...(s.surfaces ?? {}),
      podcast: s.surfaces?.podcast ?? podcastSurfaceFromShow(s),
      youtube: yt,
    };
    out.push(
      withPriors({
        ...s,
        youtube_channel_id: s.youtube_channel_id ?? youtubeChannelFor.get(s.id),
        surfaces,
      })
    );
  }
  return out;
}
