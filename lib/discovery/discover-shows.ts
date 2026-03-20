// ============================================================
// SHOW DISCOVERY ORCHESTRATOR
// Searches Podscan + YouTube APIs in parallel to discover shows
// matching a campaign brief. Returns Show[] formatted identically
// to database shows for seamless merging.
//
// STRATEGY:
// 1. Search Podscan via /episodes/search with 5-6 diverse text queries,
//    each filtered by category IDs. Extract unique podcasts from results.
// 2. Search YouTube by interest terms (YouTube API needs keywords)
// 3. Deduplicate across all queries by podcast_id
// 4. Claude scores the final fit using brand context + keywords
// ============================================================

import type { Show } from "@/lib/data/types";
import { getPodscanClientSafe, type PodscanPodcast } from "@/lib/enrichment/podscan";
import { getYouTubeClientSafe } from "@/lib/enrichment/youtube";
import { buildYouTubeQuery, buildDiscoveryQueries } from "./category-mapping";
import { podscanPodcastToShow, youtubeChannelToShow } from "./format-discovered-show";

export interface DiscoveryBrief {
  target_interests: string[];
  keywords: string[];
  target_age_range?: string;
  target_gender?: string;
  campaign_goals?: string;
  platforms: string[];
}

export interface DiscoveryResult {
  discovered: Show[];
  sources: { podscan: number; youtube: number };
  errors: string[];
}

/** Minimum audience size for discovered shows */
const MIN_PODCAST_AUDIENCE = 5000;
const MIN_YOUTUBE_AVG_VIEWS = 10000;
const MIN_YOUTUBE_VIDEO_COUNT = 20;

/** Keywords that indicate a YouTube channel is a brand/company, not a creator */
const BRAND_CHANNEL_KEYWORDS = [
  "shop", "store", "buy now", "official website", "our products",
  "order now", "free shipping", "discount code", "use code",
  "shop now", "our company", "founded in", "we manufacture",
];

/**
 * Discover shows from Podscan and YouTube APIs based on a campaign brief.
 *
 * Podscan: 5-6 diverse queries via /episodes/search, extracting unique podcasts.
 * YouTube: searched by interest terms (YouTube API requires text queries).
 *
 * API budget per call:
 * - Podscan: 5-6 requests (well within 10/min limit with staggering)
 * - YouTube: 1 search + 1 batch channel details + up to 3 video stats = ~5 requests
 */
export async function discoverShows(brief: DiscoveryBrief): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const discovered: Show[] = [];

  const wantsPodcast = brief.platforms.includes("podcast");
  const wantsYoutube = brief.platforms.includes("youtube");

  // Build YouTube query from interests (YouTube API needs text, not category IDs)
  const youtubeQuery = buildYouTubeQuery(brief);

  // Run Podscan + YouTube discovery in parallel
  const [podcastShows, youtubeShows] = await Promise.all([
    wantsPodcast ? discoverFromPodscan(brief, errors) : Promise.resolve([]),
    wantsYoutube ? discoverFromYoutube(youtubeQuery, errors) : Promise.resolve([]),
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

/**
 * Search YouTube for channels. Makes 1 search + 1 batch details call.
 * YouTube API requires text queries, so we use interest-derived terms.
 * Optionally fetches recent video stats for top 3 channels.
 */
async function discoverFromYoutube(
  query: string,
  errors: string[]
): Promise<Show[]> {
  const client = getYouTubeClientSafe();
  if (!client) return [];

  try {
    const searchResults = await client.searchChannels(query, 20);
    if (searchResults.length === 0) return [];

    const channelIds = searchResults.map((r) => r.channelId);
    const channelDetails = await client.getMultipleChannelDetails(channelIds);
    if (channelDetails.length === 0) return [];

    const top3 = channelDetails
      .sort((a, b) => b.subscriberCount - a.subscriberCount)
      .slice(0, 3);

    const statsPromises = top3.map((ch) =>
      client.getRecentVideoStats(ch.channelId, 5).catch(() => null)
    );
    const statsResults = await Promise.all(statsPromises);

    const statsMap = new Map<string, NonNullable<(typeof statsResults)[0]>>();
    for (let i = 0; i < top3.length; i++) {
      if (statsResults[i]) {
        statsMap.set(top3[i].channelId, statsResults[i]!);
      }
    }

    return channelDetails
      .filter((ch) => {
        // Filter out channels with too few videos — real creators have substantial libraries
        if (ch.videoCount < MIN_YOUTUBE_VIDEO_COUNT) return false;

        // Filter out brand/company channels by checking description for commercial keywords
        const descLower = (ch.description ?? "").toLowerCase();
        const isBrandChannel = BRAND_CHANNEL_KEYWORDS.some((kw) => descLower.includes(kw));
        if (isBrandChannel) return false;

        // Use avg views if available, otherwise estimate from total views / video count
        const stats = statsMap.get(ch.channelId);
        const avgViews = stats?.averageViews ??
          Math.round(ch.totalViewCount / Math.max(ch.videoCount, 1));
        return avgViews >= MIN_YOUTUBE_AVG_VIEWS;
      })
      .map((ch) => youtubeChannelToShow(ch, statsMap.get(ch.channelId) ?? undefined));
  } catch (err) {
    errors.push(`YouTube discovery failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return [];
  }
}
