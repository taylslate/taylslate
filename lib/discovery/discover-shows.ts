// ============================================================
// SHOW DISCOVERY ORCHESTRATOR
// Searches Podscan + YouTube APIs in parallel to discover shows
// matching a campaign brief. Returns Show[] formatted identically
// to database shows for seamless merging.
//
// STRATEGY:
// 1. Search Podscan by CATEGORY + AUDIENCE SIZE (not keywords)
//    → Returns shows whose audiences match the brand's target demo
// 2. Search YouTube by interest terms (YouTube API needs keywords)
// 3. Keywords from the brief are passed to Claude for scoring,
//    NOT used as Podscan search terms
// ============================================================

import type { Show } from "@/lib/data/types";
import { getPodscanClientSafe, type PodscanPodcast } from "@/lib/enrichment/podscan";
import { getYouTubeClientSafe } from "@/lib/enrichment/youtube";
import { buildYouTubeQuery, mapInterestsToPodscanCategoryIds } from "./category-mapping";
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
const MIN_YOUTUBE_SUBSCRIBERS = 1000;

/**
 * Discover shows from Podscan and YouTube APIs based on a campaign brief.
 *
 * Podscan: searched by CATEGORY + AUDIENCE SIZE, not by keywords.
 * YouTube: searched by interest terms (YouTube API requires text queries).
 * Keywords from the brief go to Claude for fit scoring, not to API search.
 *
 * API budget per call:
 * - Podscan: 1-2 requests (category searches, well within 10/min limit)
 * - YouTube: 1 search + 1 batch channel details + up to 3 video stats = ~5 requests
 */
export async function discoverShows(brief: DiscoveryBrief): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const discovered: Show[] = [];

  const wantsPodcast = brief.platforms.includes("podcast");
  const wantsYoutube = brief.platforms.includes("youtube");

  // Map interests → Podscan category IDs for podcast discovery
  const categoryIds = mapInterestsToPodscanCategoryIds(brief.target_interests);

  // Build YouTube query from interests (YouTube API needs text, not category IDs)
  const youtubeQuery = buildYouTubeQuery(brief);

  // Run Podscan + YouTube discovery in parallel
  const [podcastShows, youtubeShows] = await Promise.all([
    wantsPodcast || !wantsYoutube
      ? discoverFromPodscan(categoryIds, brief, errors)
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
 * Search Podscan for podcasts by CATEGORY and AUDIENCE SIZE.
 *
 * This is the correct approach for campaign planning:
 * - A brand selling saunas needs health/fitness/wellness shows,
 *   not shows that once mentioned "sauna" in a transcript.
 * - Category + audience size finds the right AUDIENCES.
 * - Claude scores the actual fit using keywords + brand context.
 *
 * Makes 1-2 API calls depending on category breadth.
 */
async function discoverFromPodscan(
  categoryIds: string[],
  brief: DiscoveryBrief,
  errors: string[]
): Promise<Show[]> {
  const client = getPodscanClientSafe();
  if (!client) return [];

  const podcastMap = new Map<string, PodscanPodcast>();

  try {
    if (categoryIds.length === 0 && brief.target_interests.length === 0) {
      errors.push("No target interests selected for podcast discovery");
      return [];
    }

    const searchPromises: Promise<void>[] = [];

    // Search 1: Primary — shows in target categories that accept ads
    if (categoryIds.length > 0) {
      searchPromises.push(
        client
          .discoverPodcasts({
            categoryIds: categoryIds.join(","),
            minAudienceSize: MIN_PODCAST_AUDIENCE,
            hasSponsors: true,
            perPage: 25,
            orderBy: "audience_size",
          })
          .then((result) => {
            for (const podcast of result.data) {
              if (!podcastMap.has(podcast.podcast_id)) {
                podcastMap.set(podcast.podcast_id, podcast);
              }
            }
          })
          .catch((err) => {
            errors.push(
              `Podscan category search: ${err instanceof Error ? err.message : "unknown error"}`
            );
          })
      );
    }

    // Search 2: Broader — without has_sponsors filter
    // Catches shows that are great fits but haven't had detected sponsors yet
    if (categoryIds.length > 0) {
      searchPromises.push(
        client
          .discoverPodcasts({
            categoryIds: categoryIds.slice(0, 3).join(","),
            minAudienceSize: MIN_PODCAST_AUDIENCE,
            perPage: 15,
            orderBy: "audience_size",
          })
          .then((result) => {
            for (const podcast of result.data) {
              if (!podcastMap.has(podcast.podcast_id)) {
                podcastMap.set(podcast.podcast_id, podcast);
              }
            }
          })
          .catch((err) => {
            errors.push(
              `Podscan broad search: ${err instanceof Error ? err.message : "unknown error"}`
            );
          })
      );
    }

    await Promise.all(searchPromises);
  } catch (err) {
    errors.push(
      `Podscan discovery failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  // Filter: ensure minimum audience size
  const filtered = Array.from(podcastMap.values()).filter((p) => {
    const audienceSize = p.reach?.audience_size ?? 0;
    return audienceSize >= MIN_PODCAST_AUDIENCE;
  });

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
    const searchResults = await client.searchChannels(query, 10);
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
      .filter((ch) => ch.subscriberCount >= MIN_YOUTUBE_SUBSCRIBERS)
      .map((ch) => youtubeChannelToShow(ch, statsMap.get(ch.channelId) ?? undefined));
  } catch (err) {
    errors.push(`YouTube discovery failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return [];
  }
}
