// ============================================================
// FORMAT DISCOVERED SHOWS
// Converts Podscan and YouTube API responses into the Show type
// so they can be processed identically to database shows.
// ============================================================

import type { Show, ShowRateCard, ShowDemographics } from "@/lib/data/types";
import type { PodscanPodcast, PodscanReach } from "@/lib/enrichment/podscan";
import type { YouTubeChannelDetails, YouTubeRecentStats } from "@/lib/enrichment/youtube";

/**
 * Decode HTML entities that Podscan returns in podcast names/descriptions.
 * Handles &amp; &lt; &gt; &quot; &#39; and numeric entities (&#123; &#x1F4A1;).
 */
function decodeHTMLEntities(text: string): string {
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

/**
 * Industry-standard CPM defaults by audience tier.
 * These are conservative estimates — agent-provided rates always override.
 */
function getDefaultPodcastRateCard(audienceSize: number): ShowRateCard {
  if (audienceSize >= 200000) {
    return { midroll_cpm: 35, preroll_cpm: 25, postroll_cpm: 18 };
  }
  if (audienceSize >= 50000) {
    return { midroll_cpm: 28, preroll_cpm: 20, postroll_cpm: 14 };
  }
  if (audienceSize >= 10000) {
    return { midroll_cpm: 22, preroll_cpm: 15, postroll_cpm: 10 };
  }
  return { midroll_cpm: 18, preroll_cpm: 12, postroll_cpm: 8 };
}

/**
 * YouTube flat-rate defaults by subscriber count.
 * Per CLAUDE.md: $2K-$20K based on cultural significance.
 */
function getDefaultYouTubeFlatRate(subscriberCount: number): number {
  if (subscriberCount >= 1000000) return 15000;
  if (subscriberCount >= 500000) return 10000;
  if (subscriberCount >= 100000) return 5000;
  return 2000;
}

/**
 * Convert a Podscan podcast to a Taylslate Show.
 */
/**
 * Extract audience size from Podscan's reach object.
 * reach can be: { audience_size: number, email, website, ... } or undefined
 */
function extractAudienceSize(reach?: PodscanReach): number {
  if (!reach) return 0;
  return reach.audience_size ?? 0;
}

/**
 * Extract contact email from Podscan's reach object.
 */
function extractEmail(reach?: PodscanReach): string {
  return reach?.email ?? "";
}

export function podscanPodcastToShow(
  podcast: PodscanPodcast,
  sponsors?: string[]
): Show {
  const audienceSize = extractAudienceSize(podcast.reach);
  const now = new Date().toISOString();

  return {
    id: `discovered-podscan-${podcast.podcast_id}`,
    name: decodeHTMLEntities(podcast.podcast_name),
    platform: "podcast",
    description: decodeHTMLEntities(podcast.podcast_description ?? ""),
    image_url: podcast.podcast_image_url ?? undefined,

    categories: (podcast.podcast_categories ?? []).map((c: unknown) =>
      typeof c === "object" && c !== null && "category_name" in (c as Record<string, unknown>)
        ? (c as { category_name: string }).category_name
        : String(c)
    ),
    tags: [],

    network: podcast.publisher_name ?? undefined,
    contact: {
      name: podcast.publisher_name ?? "",
      email: extractEmail(podcast.reach),
      method: "email",
    },
    agent_id: undefined,

    audience_size: audienceSize,
    demographics: {} as ShowDemographics,
    audience_interests: (podcast.podcast_categories ?? []).map((c: unknown) =>
      typeof c === "object" && c !== null && "category_name" in (c as Record<string, unknown>)
        ? (c as { category_name: string }).category_name
        : String(c)
    ),

    rate_card: getDefaultPodcastRateCard(audienceSize),
    price_type: "cpm",
    min_buy: undefined,

    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    avg_episode_length_min: 45,

    current_sponsors: sponsors ?? [],
    past_sponsors: [],

    apple_id: undefined,
    spotify_id: undefined,
    youtube_channel_id: undefined,
    rss_url: podcast.rss_url ?? undefined,

    is_claimed: false,
    is_verified: false,

    available_slots: undefined,
    next_available_date: undefined,

    created_at: now,
    updated_at: now,
  };
}

/**
 * Convert a YouTube channel to a Taylslate Show.
 */
export function youtubeChannelToShow(
  channel: YouTubeChannelDetails,
  recentStats?: YouTubeRecentStats
): Show {
  // Audience size = average views per video (more useful than subscriber count)
  const audienceSize = recentStats?.averageViews ??
    Math.round(channel.totalViewCount / Math.max(channel.videoCount, 1));

  const now = new Date().toISOString();

  return {
    id: `discovered-youtube-${channel.channelId}`,
    name: channel.title,
    platform: "youtube",
    description: channel.description ?? "",
    image_url: channel.thumbnailUrl ?? undefined,

    categories: channel.topicCategories ?? [],
    tags: [],

    network: undefined,
    contact: {
      name: channel.title,
      email: "",
      method: "email",
    },
    agent_id: undefined,

    audience_size: audienceSize,
    demographics: {} as ShowDemographics,
    audience_interests: channel.topicCategories ?? [],

    rate_card: { flat_rate: getDefaultYouTubeFlatRate(channel.subscriberCount) },
    price_type: "flat_rate",
    min_buy: undefined,

    ad_formats: ["integration"],
    episode_cadence: "weekly",
    avg_episode_length_min: 15,

    current_sponsors: [],
    past_sponsors: [],

    apple_id: undefined,
    spotify_id: undefined,
    youtube_channel_id: channel.channelId,
    rss_url: undefined,

    is_claimed: false,
    is_verified: false,

    available_slots: undefined,
    next_available_date: undefined,

    created_at: now,
    updated_at: now,
  };
}
