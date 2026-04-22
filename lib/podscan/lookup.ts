// ============================================================
// Podscan podcast lookup — by RSS feed URL or Apple iTunes ID.
// Used by show onboarding (Wave 9) to auto-populate show metadata
// from whatever the creator pastes (RSS URL or Apple Podcasts link).
// ============================================================

import type { PodscanClient } from "./client";
import type { PodscanPodcast } from "./types";

interface ByRssResponse {
  podcasts: PodscanPodcast[];
  fuzzy_match?: boolean;
  cache_only?: boolean;
  skipped_inputs?: number;
  suggested_feeds?: number;
}

interface ByItunesResponse {
  // The docs describe a single podcast object, but we normalize both here
  podcasts?: PodscanPodcast[];
  podcast?: PodscanPodcast;
}

/** Look up a podcast by its RSS feed URL. Returns the first match or null. */
export async function getPodcastByRss(
  client: PodscanClient,
  rssUrl: string
): Promise<PodscanPodcast | null> {
  const res = await client.get<ByRssResponse>("/podcasts/search/by/rss", {
    rss_feed: rssUrl,
  });
  return res.podcasts?.[0] ?? null;
}

/** Look up a podcast by its Apple/iTunes numeric ID. Returns the match or null. */
export async function getPodcastByItunesId(
  client: PodscanClient,
  itunesId: string
): Promise<PodscanPodcast | null> {
  const res = await client.get<ByItunesResponse>("/podcasts/search/by/itunesid", {
    itunes_id: itunesId,
  });
  if (res.podcast) return res.podcast;
  return res.podcasts?.[0] ?? null;
}

/**
 * Extract an iTunes numeric ID from an Apple Podcasts URL.
 *   https://podcasts.apple.com/us/podcast/show-name/id1234567890  →  "1234567890"
 *   https://podcasts.apple.com/us/podcast/id1234567890             →  "1234567890"
 * Returns null if the URL doesn't look like an Apple Podcasts link.
 */
export function extractItunesId(url: string): string | null {
  const match = url.match(/\/id(\d+)(?:\?|$|\/)/);
  return match ? match[1] : null;
}

/**
 * Given whatever the user pasted (RSS URL, Apple Podcasts URL, or a naked
 * domain), try to resolve it to a Podscan podcast record.
 *
 * Order of attempts:
 *   1. If it's an Apple Podcasts URL, extract the iTunes ID and look up by that
 *   2. Otherwise treat it as an RSS feed URL and look up by that
 *      (Podscan's fuzzy matching handles missing protocols, www mismatch, etc.)
 */
export async function lookupShowByUrl(
  client: PodscanClient,
  rawUrl: string
): Promise<PodscanPodcast | null> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const itunesId = extractItunesId(trimmed);
  if (itunesId) {
    return getPodcastByItunesId(client, itunesId);
  }
  return getPodcastByRss(client, trimmed);
}
