// ============================================================
// SHOW DISCOVERY ORCHESTRATOR
// Searches Podscan + YouTube APIs in parallel to discover shows
// matching a campaign brief. Returns Show[] formatted identically
// to database shows for seamless merging.
// ============================================================

import type { Show } from "@/lib/data/types";
import { getPodscanClientSafe, type PodscanPodcast } from "@/lib/enrichment/podscan";
import { getYouTubeClientSafe } from "@/lib/enrichment/youtube";
import { buildSearchQueries, mapInterestsToPodscanCategoryIds } from "./category-mapping";
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

/**
 * Discover shows from Podscan and YouTube APIs based on a campaign brief.
 *
 * API budget per call:
 * - Podscan: 2-3 requests (well within 10/min limit)
 * - YouTube: 1 search + 1 batch channel details + up to 3 video stats = ~5 requests
 *
 * All calls run in parallel. Expected wall time: 2-4 seconds.
 * Gracefully degrades if API keys are missing.
 */
export async function discoverShows(brief: DiscoveryBrief): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const discovered: Show[] = [];

  const wantsPodcast = brief.platforms.includes("podcast");
  const wantsYoutube = brief.platforms.includes("youtube");

  // Build search queries from the brief
  const { podscanQueries, youtubeQuery } = buildSearchQueries(brief);
  const categoryIds = mapInterestsToPodscanCategoryIds(brief.target_interests);

  // Run Podscan + YouTube discovery in parallel
  const [podcastShows, youtubeShows] = await Promise.all([
    wantsPodcast || !wantsYoutube
      ? discoverFromPodscan(podscanQueries, categoryIds, errors)
      : Promise.resolve([]),
    wantsYoutube || !wantsPodcast
      ? discoverFromYoutube(youtubeQuery, errors)
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
 * Search Podscan for podcasts. Makes 2-3 API calls max.
 * Deduplicates by podcast_id across all queries.
 */
async function discoverFromPodscan(
  queries: string[],
  categoryIds: string[],
  errors: string[]
): Promise<Show[]> {
  const client = getPodscanClientSafe();
  if (!client) return [];

  const podcastMap = new Map<string, PodscanPodcast>();

  try {
    // Run all queries in parallel (2-3 calls, well within 10/min)
    const searchPromises = queries.map((query, index) =>
      client.searchPodcasts({
        query,
        perPage: index === 0 ? 15 : 10,
        categoryIds: index === 1 && categoryIds.length > 0 ? categoryIds.join(",") : undefined,
        hasSponsors: true,
        orderBy: "best_match",
      }).catch((err) => {
        errors.push(`Podscan search "${query}": ${err instanceof Error ? err.message : "unknown error"}`);
        return { data: [], pagination: { total: 0, per_page: 0, current_page: 0, last_page: 0 } };
      })
    );

    const results = await Promise.all(searchPromises);

    // Extract unique podcasts from episode results
    for (const result of results) {
      for (const episode of result.data) {
        const podcast = episode.podcast;
        if (podcast && !podcastMap.has(podcast.podcast_id)) {
          // Only include podcasts with meaningful audience data
          if ((podcast.reach ?? 0) >= 1000) {
            podcastMap.set(podcast.podcast_id, podcast);
          }
        }
      }
    }
  } catch (err) {
    errors.push(`Podscan discovery failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // Convert to Show objects
  return Array.from(podcastMap.values()).map((p) => podscanPodcastToShow(p));
}

/**
 * Search YouTube for channels. Makes 1 search + 1 batch details call.
 * Optionally fetches recent video stats for top 3 channels.
 */
async function discoverFromYoutube(
  query: string,
  errors: string[]
): Promise<Show[]> {
  const client = getYouTubeClientSafe();
  if (!client) return [];

  try {
    // Step 1: Search for channels
    const searchResults = await client.searchChannels(query, 10);
    if (searchResults.length === 0) return [];

    // Step 2: Batch get channel details (single API call)
    const channelIds = searchResults.map((r) => r.channelId);
    const channelDetails = await client.getMultipleChannelDetails(channelIds);
    if (channelDetails.length === 0) return [];

    // Step 3: Get recent video stats for top 3 channels (for accurate audience_size)
    const top3 = channelDetails
      .sort((a, b) => b.subscriberCount - a.subscriberCount)
      .slice(0, 3);

    const statsPromises = top3.map((ch) =>
      client.getRecentVideoStats(ch.channelId, 5).catch(() => null)
    );
    const statsResults = await Promise.all(statsPromises);

    // Build a map of channelId -> recentStats
    const statsMap = new Map<string, NonNullable<typeof statsResults[0]>>();
    for (let i = 0; i < top3.length; i++) {
      if (statsResults[i]) {
        statsMap.set(top3[i].channelId, statsResults[i]!);
      }
    }

    // Convert to Show objects (only channels with >1000 subscribers)
    return channelDetails
      .filter((ch) => ch.subscriberCount >= 1000)
      .map((ch) => youtubeChannelToShow(ch, statsMap.get(ch.channelId) ?? undefined));
  } catch (err) {
    errors.push(`YouTube discovery failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return [];
  }
}
